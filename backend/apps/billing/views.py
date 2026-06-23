from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import PaymentInvoice, PayoutRequest, Transaction
from apps.billing.serializers import (
    InvoiceSerializer,
    PayoutRequestSerializer,
    TransactionSerializer,
)
from apps.billing.services import MonobankService
from apps.tournaments.models import Registration, Tournament


def calculate_registration_fee(reg):
    price = reg.category.get_athlete_fee()
    if reg.category.is_team:
        price = price * (reg.category.team_size or 3)
    return price


def create_monobank_invoice(db_invoice, amount_uah, destination, redirect_url, webhook_url):
    try:
        mono_data = MonobankService.create_invoice(
            invoice_id=db_invoice.id,
            amount_uah=amount_uah,
            destination=destination,
            redirect_url=redirect_url,
            webhook_url=webhook_url,
        )
        db_invoice.invoice_id = mono_data["invoiceId"]
        db_invoice.payment_url = mono_data["pageUrl"]
        db_invoice.save(update_fields=["invoice_id", "payment_url"])
        return Response(InvoiceSerializer(db_invoice).data, status=status.HTTP_201_CREATED)
    except Exception as e:
        db_invoice.status = PaymentInvoice.Status.FAILED
        db_invoice.save(update_fields=["status"])
        return Response(
            {"detail": f"Не вдалося згенерувати платіж Monobank: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    """Ендпоінти для перегляду та створення рахунків на оплату."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        user = self.request.user
        if user.role == "admin":
            return PaymentInvoice.objects.all()
        q = Q(user=user)
        if user.role == "organizer":
            q |= Q(registrations__category__tournament__organizer=user)
            q |= Q(tournament__organizer=user)
            q |= Q(tournaments__organizer=user)
        return PaymentInvoice.objects.filter(q).distinct()

    def create(self, request, *args, **kwargs):
        """Створення інвойсу (рахунку в Monobank).

        Параметри:
        - payment_type: "registrations" або "platform_fee"
        - redirect_url: URL куди Monobank поверне покупця після оплати
        - registration_ids: [1, 2, 3] (для registrations)
        - tournament_id: 123 (для platform_fee)
        """
        payment_type = request.data.get("payment_type", "registrations")
        redirect_url = request.data.get("redirect_url")
        if not redirect_url:
            return Response(
                {"detail": "Параметр redirect_url є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if payment_type == "registrations":
            reg_ids = request.data.get("registration_ids", [])
            if not isinstance(reg_ids, list) or not reg_ids:
                return Response(
                    {"detail": "Потрібно передати список registration_ids."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Отримуємо реєстрації
            registrations = Registration.objects.filter(id__in=reg_ids).select_related(
                "category__tournament", "athlete__coach", "team__coach"
            )
            if registrations.count() != len(reg_ids):
                return Response(
                    {"detail": "Деякі реєстрації не знайдено."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Перевіряємо права та неоплаченість
            for reg in registrations:
                if reg.payment_status == "paid":
                    return Response(
                        {"detail": f"Реєстрація {reg} вже оплачена."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if reg.status == Registration.Status.REJECTED:
                    return Response(
                        {"detail": f"Реєстрація {reg} відхилена."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Доступність: тренер своєї дитини АБО керівник клубу для членів клубу
                is_owner = False
                if reg.athlete and reg.athlete.coach == request.user:
                    is_owner = True
                elif reg.team and reg.team.coach == request.user:
                    is_owner = True

                is_club_rep = False
                if request.user.is_club_leader and request.user.club:
                    if reg.athlete and reg.athlete.club == request.user.club:
                        is_club_rep = True
                    elif reg.team and reg.team.club == request.user.club:
                        is_club_rep = True

                if not (is_owner or is_club_rep):
                    return Response(
                        {"detail": f"У вас немає прав на оплату реєстрації {reg}."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            # Розрахунок суми
            total_amount = 0
            for reg in registrations:
                base_fee = calculate_registration_fee(reg)
                # Комісія платника: якщо комісію платить покупець (buyer), додаємо 5%
                if reg.category.tournament.commission_payer == "buyer":
                    total_amount += int(base_fee * 1.05)
                else:
                    total_amount += base_fee

            if total_amount <= 0:
                return Response(
                    {"detail": "Загальна сума до сплати має бути більшою за 0 UAH."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Транзакційність: скасовуємо старі pending інвойси на ці реєстрації
            with transaction.atomic():
                old_invoices = PaymentInvoice.objects.filter(
                    registrations__in=registrations, status=PaymentInvoice.Status.PENDING
                ).distinct()

                for old_inv in old_invoices:
                    if old_inv.invoice_id:
                        MonobankService.cancel_invoice(old_inv.invoice_id)
                    old_inv.status = PaymentInvoice.Status.EXPIRED
                    old_inv.save(update_fields=["status"])

                # Створюємо новий рахунок у базі
                db_invoice = PaymentInvoice.objects.create(
                    user=request.user,
                    payment_type=payment_type,
                    amount=total_amount,
                    status=PaymentInvoice.Status.PENDING,
                    tournament=registrations[0].category.tournament if registrations else None,
                )
                db_invoice.registrations.set(registrations)

            # Створюємо рахунок в Monobank
            names_list = []
            for reg in registrations:
                if reg.athlete:
                    names_list.append(f"{reg.athlete.last_name} {reg.athlete.first_name}")
                elif reg.team:
                    names_list.append(reg.team.name)
            names_str = ", ".join(names_list)
            destination = f"Внесок: {names_str}"
            if len(destination) > 100:
                destination = destination[:97] + "..."
            webhook_url = request.build_absolute_uri("/api/billing/webhook/monobank/")

            return create_monobank_invoice(
                db_invoice=db_invoice,
                amount_uah=total_amount,
                destination=destination,
                redirect_url=redirect_url,
                webhook_url=webhook_url,
            )

        elif payment_type == "platform_fee":
            tournament_ids = request.data.get("tournament_ids", [])
            if not tournament_ids:
                single_id = request.data.get("tournament_id")
                if single_id:
                    tournament_ids = [single_id]

            if not tournament_ids:
                return Response(
                    {"detail": "Не вказано жодного турніру для оплати комісії."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            tournaments = Tournament.objects.filter(id__in=tournament_ids)
            if not tournaments.exists():
                return Response(
                    {"detail": "Турніри не знайдено."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Перевіряємо права та статус оплат
            for t in tournaments:
                if t.organizer != request.user and request.user.role != "admin":
                    return Response(
                        {
                            "detail": (
                                f"Тільки організатор може сплатити комісію за турнір '{t.title}'."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if t.platform_fee_status == "paid" or t.platform_fee_amount == 0:
                    return Response(
                        {
                            "detail": (
                                f"Комісія за турнір '{t.title}' вже сплачена або дорівнює нулю."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            total_debt_amount = sum(t.platform_fee_amount for t in tournaments)

            # Скасовуємо старі рахунки на ці турніри
            with transaction.atomic():
                old_invoices = PaymentInvoice.objects.filter(
                    Q(tournament__in=tournaments) | Q(tournaments__in=tournaments),
                    payment_type="platform_fee",
                    status=PaymentInvoice.Status.PENDING,
                ).distinct()
                for old_inv in old_invoices:
                    if old_inv.invoice_id:
                        MonobankService.cancel_invoice(old_inv.invoice_id)
                    old_inv.status = PaymentInvoice.Status.EXPIRED
                    old_inv.save(update_fields=["status"])

                db_invoice = PaymentInvoice.objects.create(
                    user=request.user,
                    payment_type=payment_type,
                    amount=total_debt_amount,
                    status=PaymentInvoice.Status.PENDING,
                    tournament=tournaments[0] if len(tournaments) == 1 else None,
                )
                db_invoice.tournaments.set(tournaments)

            if len(tournaments) == 1:
                destination = f"Оплата комісії за турнір '{tournaments[0].title}'"
            else:
                destination = f"Оплата комісії за {len(tournaments)} турнірів"

            webhook_url = request.build_absolute_uri("/api/billing/webhook/monobank/")

            return create_monobank_invoice(
                db_invoice=db_invoice,
                amount_uah=total_debt_amount,
                destination=destination,
                redirect_url=redirect_url,
                webhook_url=webhook_url,
            )

        return Response({"detail": "Невідомий тип оплати."}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="sync")
    def sync_status(self, request, pk=None):
        """Ручна синхронізація статусу рахунку з Monobank (якщо не прийшов вебхук)."""
        invoice = get_object_or_404(PaymentInvoice, pk=pk, user=request.user)
        if invoice.status != PaymentInvoice.Status.PENDING:
            return Response(
                {"detail": "Синхронізація доступна лише для очікуючих рахунків."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not invoice.invoice_id:
            return Response(
                {"detail": "Інвойс не містить ID платіжної системи."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            mono_status = MonobankService.get_invoice_status(invoice.invoice_id)
            status_str = mono_status.get("status")

            if status_str == "success":
                payment_infos = mono_status.get("paymentInfos", [])
                receipt_id = None
                if payment_infos:
                    receipt_id = payment_infos[0].get("receiptId")

                # Проводимо оплату
                process_successful_payment(invoice, f"sync-{invoice.id}", receipt_id)
                return Response(
                    {
                        "detail": "Оплату успішно підтверджено.",
                        "invoice": InvoiceSerializer(invoice).data,
                    }
                )
            elif status_str in ("failure", "expired"):
                with transaction.atomic():
                    invoice.status = PaymentInvoice.Status.EXPIRED
                    invoice.save(update_fields=["status"])
                return Response(
                    {
                        "detail": "Рахунок скасовано або термін дії закінчився.",
                        "invoice": InvoiceSerializer(invoice).data,
                    }
                )

            return Response(
                {
                    "detail": "Статус платіжної системи не змінився.",
                    "invoice": InvoiceSerializer(invoice).data,
                }
            )
        except Exception as e:
            return Response(
                {"detail": f"Помилка при запиті до Monobank: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """Перегляд історії оплат та отримання офіційних квитанцій."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TransactionSerializer

    def get_queryset(self):
        # Користувач бачить свої транзакції.
        # Організатор бачить транзакції по своїх турнірах.
        # Адмін бачить всі.
        user = self.request.user
        if user.role == "admin":
            return Transaction.objects.all()

        q = Q(user=user)

        # Організатор може бачити оплати внесків по його турнірах
        if user.role == "organizer":
            q |= Q(invoice__registrations__category__tournament__organizer=user)
            q |= Q(invoice__tournament__organizer=user)

        return Transaction.objects.filter(q).distinct()


class MonobankWebhookView(APIView):
    """Публічний ендпоінт для вебхуків Monobank (без авторизації)."""

    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        x_sign = request.headers.get("X-Sign")

        # Перевірка підпису вебхуку
        if not MonobankService.verify_signature(x_sign, request.body):
            return Response(
                {"detail": "Недійсний підпис X-Sign."}, status=status.HTTP_400_BAD_REQUEST
            )

        # Отримуємо референс рахунку
        reference = request.data.get("reference")
        invoice_id = request.data.get("invoiceId")
        mono_status = request.data.get("status")

        if not invoice_id:
            return Response({"detail": "Відсутній invoiceId."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Знаходимо наш рахунок по ID інвойсу Monobank або по PK
            invoice = None
            if reference and reference.isdigit():
                invoice = PaymentInvoice.objects.filter(id=int(reference)).first()
            if not invoice:
                invoice = PaymentInvoice.objects.filter(invoice_id=invoice_id).first()

            if not invoice:
                return Response({"detail": "Інвойс не знайдено."}, status=status.HTTP_404_NOT_FOUND)

            if mono_status == "success":
                # Оплата успішна
                # Зчитуємо receiptId (у вебхуку він може бути в paymentInfos)
                payment_infos = request.data.get("paymentInfos", [])
                receipt_id = None
                if payment_infos and isinstance(payment_infos, list):
                    receipt_id = payment_infos[0].get("receiptId")
                elif isinstance(payment_infos, dict):
                    # Про всяк випадок, якщо Monobank поверне об'єкт
                    receipt_id = payment_infos.get("receiptId")

                process_successful_payment(invoice, invoice_id, receipt_id)
            elif mono_status in ("failure", "expired", "reversed"):
                # Помилка або закінчення терміну
                with transaction.atomic():
                    invoice.status = PaymentInvoice.Status.EXPIRED
                    invoice.save(update_fields=["status"])

            return Response("OK", status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {"detail": f"Внутрішня помилка обробки вебхуку: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


def process_successful_payment(invoice, reference_str, receipt_id):
    """Спільна бізнес-логіка для вебхуку та ручної синхронізації."""
    if invoice.status == PaymentInvoice.Status.PAID:
        return

    if receipt_id:
        receipt_url = f"https://www.monobank.ua/receipts/{receipt_id}"
    else:
        # У Sandbox-режимі Monobank не повертає реальний receiptId (масив paymentInfos порожній),
        # тому ми підставляємо демонстраційне посилання для зручності перевірки інтерфейсу.
        receipt_url = "https://www.monobank.ua/receipts/demo-sandbox-receipt"

    # Обгортаємо в транзакцію
    with transaction.atomic():
        # Захоплюємо ексклюзивне блокування рядка рахунку
        invoice = PaymentInvoice.objects.select_for_update().get(id=invoice.id)
        if invoice.status == PaymentInvoice.Status.PAID:
            return

        if invoice.payment_type == PaymentInvoice.PaymentType.REGISTRATIONS:
            # Блокуємо рядки реєстрацій для уникнення race conditions
            registrations = invoice.registrations.select_for_update().all()

            # Перевіряємо, чи немає вже оплачених іншим шляхом
            already_paid = [r for r in registrations if r.payment_status == "paid"]

            if already_paid:
                # Конфлікт оплат (вже було оплачено тренером/президентом раніше)
                # Фіксуємо транзакцію, але з прапором requires_refund
                Transaction.objects.create(
                    invoice=invoice,
                    user=invoice.user,
                    payment_type=invoice.payment_type,
                    amount=invoice.amount,
                    method=Transaction.Method.ONLINE,
                    reference=f"REFUND-{reference_str}",
                    monobank_receipt_id=receipt_id or "",
                    receipt_url=receipt_url,
                    requires_refund=True,
                )
                invoice.status = PaymentInvoice.Status.FAILED
                invoice.save(update_fields=["status"])
            else:
                # Звичайна оплата
                registrations.update(payment_status="paid", payment_method="online")
                Transaction.objects.create(
                    invoice=invoice,
                    user=invoice.user,
                    payment_type=invoice.payment_type,
                    amount=invoice.amount,
                    method=Transaction.Method.ONLINE,
                    reference=reference_str,
                    monobank_receipt_id=receipt_id or "",
                    receipt_url=receipt_url,
                )
                invoice.status = PaymentInvoice.Status.PAID
                invoice.save(update_fields=["status"])

        elif invoice.payment_type == PaymentInvoice.PaymentType.PLATFORM_FEE:
            tournament = invoice.tournament
            if tournament:
                # Оновлюємо статус боргу турніру
                tournament.platform_fee_status = "paid"
                tournament.save(update_fields=["platform_fee_status"])

            # Також оновлюємо для bulk-інвойсів
            if invoice.tournaments.exists():
                invoice.tournaments.all().update(platform_fee_status="paid")

            Transaction.objects.create(
                invoice=invoice,
                user=invoice.user,
                payment_type=invoice.payment_type,
                amount=invoice.amount,
                method=Transaction.Method.ONLINE,
                reference=reference_str,
                monobank_receipt_id=receipt_id or "",
                receipt_url=receipt_url,
            )
            invoice.status = PaymentInvoice.Status.PAID
            invoice.save(update_fields=["status"])


class PayoutRequestViewSet(viewsets.ModelViewSet):
    serializer_class = PayoutRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = PayoutRequest.objects.all()

        # Admin can see all, organizer only their own
        if user.role != "admin":
            qs = qs.filter(organizer=user)

        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(tournament_id=tournament_id)

        return qs

    def perform_create(self, serializer):
        tournament = serializer.validated_data.get("tournament")
        if tournament.organizer != self.request.user and self.request.user.role != "admin":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Ви не є організатором цього турніру.")

        if tournament.status != "completed":
            from rest_framework.exceptions import ValidationError

            raise ValidationError("Виведення коштів доступне лише для завершених турнірів.")

        # Construct a unified bank_details string for backward compatibility
        iban = serializer.validated_data.get("iban", "")
        recipient_name = serializer.validated_data.get("recipient_name", "")
        recipient_code = serializer.validated_data.get("recipient_code", "")
        bank_details = f"IBAN: {iban}, Отримувач: {recipient_name}, Код: {recipient_code}"

        serializer.save(organizer=self.request.user, bank_details=bank_details)

    def perform_update(self, serializer):
        if self.request.user.role != "admin":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Тільки адміністратор може змінювати запити на виплату.")

        old_status = serializer.instance.status
        instance = serializer.save()

        if (
            old_status != PayoutRequest.Status.COMPLETED
            and instance.status == PayoutRequest.Status.COMPLETED
        ):
            tournament = instance.tournament
            if tournament.platform_fee_status == "unpaid":
                tournament.platform_fee_status = "paid"
                tournament.save(update_fields=["platform_fee_status"])
