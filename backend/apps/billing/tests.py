import urllib.error
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.billing.models import PaymentInvoice, Transaction
from apps.billing.services import MonobankService
from apps.tournaments.models import Category, Registration, Tournament


@override_settings(MONOBANK_MOCK_PAYMENTS=True)
class BillingAPITestCase(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Клуби
        self.club = Club.objects.create(name="Федерація Карате", region="vinnytsia")

        # Користувачі
        self.admin = User.objects.create_superuser(
            email="admin@billing.test",
            password="testpassword",
        )
        self.organizer = User.objects.create_user(
            email="organizer@billing.test",
            password="testpassword",
            first_name="Оргі",
            last_name="Турніренко",
            role=User.Role.ORGANIZER,
            club=self.club,
        )
        self.coach = User.objects.create_user(
            email="coach@billing.test",
            password="testpassword",
            first_name="Тренер",
            last_name="Коченко",
            role=User.Role.COACH,
            club=self.club,
        )
        self.coach_b = User.objects.create_user(
            email="coach_b@billing.test",
            password="testpassword",
            first_name="Тренер Б",
            last_name="Петренко",
            role=User.Role.COACH,
            club=self.club,
        )

        # Турнір
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Фінал Кубку",
            sport_type="Карате WKF",
            location="Вінниця",
            start_date=timezone.now() + timedelta(days=10),
            end_date=timezone.now() + timedelta(days=11),
            status=Tournament.Status.REGISTRATION,
            refund_policy="refundable",
            commission_payer="buyer",
        )

        # Категорія
        self.category = Category.objects.create(
            name="Категорія 1",
            tournament=self.tournament,
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=35,
            min_weight=70,
            max_weight=80,
            registration_fee=500,
        )

        # Спортсмени
        self.athlete_a = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Олег",
            last_name="Спортсменко",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=75,
        )
        self.athlete_b = Athlete.objects.create(
            coach=self.coach_b,
            club=self.club,
            first_name="Дмитро",
            last_name="Спортсменко-Б",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=75,
        )

        # Реєстрації
        self.reg_a = Registration.objects.create(
            athlete=self.athlete_a,
            category=self.category,
            status=Registration.Status.PENDING,
            payment_status="unpaid",
        )
        self.reg_b = Registration.objects.create(
            athlete=self.athlete_b,
            category=self.category,
            status=Registration.Status.PENDING,
            payment_status="unpaid",
        )

    def _login(self, user):
        self.client.force_authenticate(user=user)

    def test_invoice_creation_own_athlete_success(self):
        """Звичайний тренер може успішно створити інвойс за своїх вихованців."""
        self._login(self.coach)
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("payment_url", response.data)
        # Сума з урахуванням 5% комісії покупця (500 * 1.05 = 525)
        self.assertEqual(response.data["amount"], 525)

        # Перевірка запису в БД
        invoice = PaymentInvoice.objects.get(id=response.data["id"])
        self.assertEqual(invoice.status, PaymentInvoice.Status.PENDING)
        self.assertEqual(invoice.registrations.count(), 1)

    def test_invoice_creation_other_athlete_fails(self):
        """Звичайний тренер не може платити за спортсмена іншого тренера."""
        self._login(self.coach)
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_b.id],  # належить coach_b
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invoice_creation_club_president_success(self):
        """Керівник клубу (is_club_leader) може платити за вихованців інших тренерів свого клубу."""
        # Робимо coach керівником клубу
        self.coach.is_club_leader = True
        self.coach.save()

        self._login(self.coach)
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id, self.reg_b.id],  # обидва в тому ж клубі
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["amount"], 1050)  # (500 + 500) * 1.05 = 1050

    def test_overlapping_invoice_cancellation(self):
        """Створення нового інвойсу скасовує старі pending інвойси на ті ж реєстрації."""
        self._login(self.coach)
        # Перший інвойс
        r1 = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id],
            },
            format="json",
        )
        inv1 = PaymentInvoice.objects.get(id=r1.data["id"])
        self.assertEqual(inv1.status, PaymentInvoice.Status.PENDING)

        # Другий інвойс на ту ж реєстрацію
        r2 = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id],
            },
            format="json",
        )
        inv1.refresh_from_db()
        self.assertEqual(inv1.status, PaymentInvoice.Status.EXPIRED)

        inv2 = PaymentInvoice.objects.get(id=r2.data["id"])
        self.assertEqual(inv2.status, PaymentInvoice.Status.PENDING)

    def test_webhook_successful_payment_processing(self):
        """Отримання успішного вебхуку від Monobank переводить реєстрації в оплачено."""
        self._login(self.coach)
        r = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id],
            },
            format="json",
        )
        inv_id = r.data["id"]
        invoice = PaymentInvoice.objects.get(id=inv_id)

        # Симулюємо успішний вебхук
        webhook_data = {
            "invoiceId": invoice.invoice_id,
            "status": "success",
            "reference": str(invoice.id),
            "amount": invoice.amount * 100,
            "paymentInfos": [{"receiptId": "MN-1234-5678"}],
        }

        # Публічний вебхук
        response = self.client.post(
            "/api/billing/webhook/monobank/",
            webhook_data,
            format="json",
            HTTP_X_SIGN="mock-signature",  # mock перевірка пройде
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, PaymentInvoice.Status.PAID)

        self.reg_a.refresh_from_db()
        self.assertEqual(self.reg_a.payment_status, "paid")
        self.assertEqual(self.reg_a.payment_method, "online")

        # Перевірка транзакції та посилання на офіційний чек
        tx = Transaction.objects.get(invoice=invoice)
        self.assertEqual(tx.amount, 525)
        self.assertEqual(tx.monobank_receipt_id, "MN-1234-5678")
        self.assertEqual(tx.receipt_url, "https://www.monobank.ua/receipts/MN-1234-5678")

    def test_concurrency_conflict_resolution(self):
        """Якщо реєстрація сплачена паралельно,
        другий вебхук створює транзакцію з прапором requires_refund.
        """
        self._login(self.coach)
        # Інвойс 1
        r1 = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://localhost:3000/success",
                "registration_ids": [self.reg_a.id],
            },
            format="json",
        )
        inv1 = PaymentInvoice.objects.get(id=r1.data["id"])

        # Ми симулюємо, що хтось паралельно сплатив цю ж реєстрацію офлайн або через інший інвойс
        self.reg_a.payment_status = "paid"
        self.reg_a.payment_method = "offline"
        self.reg_a.save()

        # Симулюємо вебхук для інвойсу 1
        webhook_data = {
            "invoiceId": inv1.invoice_id,
            "status": "success",
            "reference": str(inv1.id),
            "amount": inv1.amount * 100,
            "paymentInfos": [{"receiptId": "MN-CONFLICT"}],
        }

        response = self.client.post(
            "/api/billing/webhook/monobank/",
            webhook_data,
            format="json",
            HTTP_X_SIGN="mock-signature",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        inv1.refresh_from_db()
        # Інвойс фейлиться, оскільки реєстрація вже була сплачена
        self.assertEqual(inv1.status, PaymentInvoice.Status.FAILED)

        # Створюється конфліктна транзакція з requires_refund = True
        tx = Transaction.objects.get(invoice=inv1)
        self.assertTrue(tx.requires_refund)
        self.assertEqual(tx.monobank_receipt_id, "MN-CONFLICT")

    def test_organizer_credit_limit_validation(self):
        """Організатор блокується на створення турнірів при перевищенні кредитного ліміту."""
        # Створимо завершений турнір з неоплаченою комісією в 1500 UAH
        Tournament.objects.create(
            organizer=self.organizer,
            title="Старий Турнір",
            sport_type="Карате",
            location="Вінниця",
            start_date=timezone.now() - timedelta(days=5),
            end_date=timezone.now() - timedelta(days=4),
            status=Tournament.Status.COMPLETED,
            platform_fee_amount=1500,
            platform_fee_status="unpaid",
        )

        # Ліміт організатора за замовчуванням 1000 UAH. 1500 > 1000 -> блок.
        self._login(self.organizer)
        response = self.client.post(
            "/api/tournaments/",
            {
                "title": "Новий Турнір",
                "sport_type": "Карате",
                "location": "Київ",
                "start_date": timezone.now() + timedelta(days=15),
                "end_date": timezone.now() + timedelta(days=16),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "перевищує встановлений кредитний ліміт", response.data["non_field_errors"][0]
        )

    def test_withdrawal_triggers_refund_in_refundable_tournament(self):
        """Зняття спортсмена у refundable турнірі автоматично ініціює повернення внеску."""
        self.reg_a.payment_status = "paid"
        self.reg_a.payment_method = "online"
        self.reg_a.save()

        # Зв'язуємо з оплаченим інвойсом
        invoice = PaymentInvoice.objects.create(
            user=self.coach,
            amount=525,
            status=PaymentInvoice.Status.PAID,
            invoice_id="inv-refundable",
        )
        invoice.registrations.add(self.reg_a)
        Transaction.objects.create(
            invoice=invoice,
            user=self.coach,
            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
            amount=525,
            method=Transaction.Method.ONLINE,
            reference="TX-111",
        )

        # Вилучаємо/знімаємо заявку через секретаря
        self._login(self.organizer)
        response = self.client.patch(
            f"/api/registrations/{self.reg_a.id}/",
            {"status": "withdrawn"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.reg_a.refresh_from_db()
        self.assertEqual(self.reg_a.status, Registration.Status.WITHDRAWN)
        # Статус оплати скинуто на unpaid (кошти повернуто)
        self.assertEqual(self.reg_a.payment_status, "unpaid")

        # Перевірка наявності транзакції повернення (refund)
        tx_refund = Transaction.objects.get(transaction_type=Transaction.Type.REFUND)
        self.assertEqual(tx_refund.amount, -500)

    def test_withdrawal_no_refund_in_non_refundable_tournament(self):
        """Зняття спортсмена у non_refundable турнірі залишає внесок оплаченим (штраф)."""
        self.tournament.refund_policy = "non_refundable"
        self.tournament.save()

        self.reg_a.payment_status = "paid"
        self.reg_a.payment_method = "online"
        self.reg_a.save()

        # Вилучаємо заявку
        self._login(self.organizer)
        response = self.client.patch(
            f"/api/registrations/{self.reg_a.id}/",
            {"status": "withdrawn"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.reg_a.refresh_from_db()
        self.assertEqual(self.reg_a.status, Registration.Status.WITHDRAWN)
        # Статус оплати залишається paid (штраф за зняття)
        self.assertEqual(self.reg_a.payment_status, "paid")

        # Перевірка відсутності транзакції повернення
        self.assertFalse(
            Transaction.objects.filter(transaction_type=Transaction.Type.REFUND).exists()
        )

    def test_online_payment_modification_lock(self):
        """Заборонено змінювати статус оплати або метод для успішно оплачених онлайн-заявок."""
        self.reg_a.payment_status = "paid"
        self.reg_a.payment_method = "online"
        self.reg_a.save()

        self._login(self.organizer)
        response = self.client.patch(
            f"/api/registrations/{self.reg_a.id}/",
            {"payment_status": "unpaid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "Неможливо змінити статус успішної онлайн-оплати", response.data["payment_status"][0]
        )


@override_settings(MONOBANK_MOCK_PAYMENTS=False)
class BillingViewsAndServicesTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.club = Club.objects.create(name="Додзьо", region="kyiv")
        self.coach = User.objects.create_user(
            email="coach_test@billing.test",
            password="testpassword",
            role=User.Role.COACH,
            club=self.club,
        )
        self.coach_other = User.objects.create_user(
            email="coach_other@billing.test",
            password="testpassword",
            role=User.Role.COACH,
            club=self.club,
        )
        self.organizer = User.objects.create_user(
            email="org_test@billing.test",
            password="testpassword",
            role=User.Role.ORGANIZER,
        )
        self.admin = User.objects.create_superuser(
            email="admin_test@billing.test",
            password="testpassword",
        )
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Тестовий Турнір",
            sport_type="Карате",
            location="Київ",
            start_date=timezone.now() + timedelta(days=10),
            end_date=timezone.now() + timedelta(days=11),
            status=Tournament.Status.REGISTRATION,
            refund_policy="refundable",
            commission_payer="seller",
            platform_fee_amount=1000,
            platform_fee_status="unpaid",
        )
        self.category = Category.objects.create(
            name="Категорія 1",
            tournament=self.tournament,
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=35,
            min_weight=70,
            max_weight=80,
            registration_fee=500,
        )
        self.athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Василь",
            last_name="Козак",
            gender=Athlete.Gender.MALE,
            birth_date=date(2005, 1, 1),
            base_weight=75,
        )
        self.reg = Registration.objects.create(
            athlete=self.athlete,
            category=self.category,
            status=Registration.Status.PENDING,
            payment_status="unpaid",
        )

    def _login(self, user):
        self.client.force_authenticate(user=user)

    # ── Services Tests ──
    @patch("urllib.request.urlopen")
    def test_services_create_invoice_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = (
            b'{"invoiceId": "mono-123", "pageUrl": "https://mono/123"}'
        )
        mock_urlopen.return_value.__enter__.return_value = mock_response

        res = MonobankService.create_invoice(
            invoice_id=456,
            amount_uah=500,
            destination="Внесок",
            redirect_url="http://success",
            webhook_url="http://webhook",
        )
        self.assertEqual(res["invoiceId"], "mono-123")
        self.assertEqual(res["pageUrl"], "https://mono/123")

    @patch("urllib.request.urlopen")
    def test_services_create_invoice_http_error(self, mock_urlopen):
        mock_fp = MagicMock()
        mock_fp.read.return_value = b'{"errCode": "BAD_AMOUNT"}'
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://mono", code=400, msg="Bad Request", hdrs={}, fp=mock_fp
        )

        with self.assertRaises(Exception) as ctx:
            MonobankService.create_invoice(
                invoice_id=456,
                amount_uah=500,
                destination="Внесок",
                redirect_url="http://success",
                webhook_url="http://webhook",
            )
        self.assertIn('Monobank API error: 400 - {"errCode": "BAD_AMOUNT"}', str(ctx.exception))

    @patch("urllib.request.urlopen")
    def test_services_cancel_invoice_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_urlopen.return_value.__enter__.return_value = mock_response

        res = MonobankService.cancel_invoice("mono-123")
        self.assertTrue(res)

    @patch("urllib.request.urlopen")
    def test_services_cancel_invoice_exception(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("Network Down")
        res = MonobankService.cancel_invoice("mono-123")
        self.assertFalse(res)

    @patch("urllib.request.urlopen")
    def test_services_refund_invoice_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "success"}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        res = MonobankService.refund_invoice("mono-123", 500, "ref-1")
        self.assertEqual(res["status"], "success")

    @patch("urllib.request.urlopen")
    def test_services_refund_invoice_http_error(self, mock_urlopen):
        mock_fp = MagicMock()
        mock_fp.read.return_value = b'{"errCode": "ALREADY_REFUNDED"}'
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://mono", code=400, msg="Bad Request", hdrs={}, fp=mock_fp
        )

        with self.assertRaises(Exception) as ctx:
            MonobankService.refund_invoice("mono-123", 500, "ref-1")
        self.assertIn(
            'Monobank API refund error: 400 - {"errCode": "ALREADY_REFUNDED"}', str(ctx.exception)
        )

    @patch("urllib.request.urlopen")
    def test_services_get_invoice_status_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "success", "receiptId": "REC-1"}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        res = MonobankService.get_invoice_status("mono-123")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["receiptId"], "REC-1")

    @patch("urllib.request.urlopen")
    def test_services_get_invoice_status_http_error(self, mock_urlopen):
        mock_fp = MagicMock()
        mock_fp.read.return_value = b'{"errCode": "NOT_FOUND"}'
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://mono", code=404, msg="Not Found", hdrs={}, fp=mock_fp
        )

        with self.assertRaises(Exception) as ctx:
            MonobankService.get_invoice_status("mono-123")
        self.assertIn(
            'Monobank API status error: 404 - {"errCode": "NOT_FOUND"}', str(ctx.exception)
        )

    @patch("django.core.cache.cache.get")
    @patch("django.core.cache.cache.set")
    @patch("urllib.request.urlopen")
    def test_services_get_public_key(self, mock_urlopen, mock_cache_set, mock_cache_get):
        mock_cache_get.return_value = "cached-key-pem"
        key = MonobankService.get_public_key()
        self.assertEqual(key, "cached-key-pem")
        mock_urlopen.assert_not_called()

        mock_cache_get.return_value = None
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"key": "fetched-key-pem"}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        key = MonobankService.get_public_key()
        self.assertEqual(key, "fetched-key-pem")
        mock_cache_set.assert_called_with("monobank_pubkey", "fetched-key-pem", timeout=86400)

        mock_urlopen.side_effect = Exception("DNS Error")
        with self.assertRaises(Exception) as ctx:
            MonobankService.get_public_key()
        self.assertIn("Failed to fetch Monobank public key: DNS Error", str(ctx.exception))

    @patch("apps.billing.services.MonobankService.get_public_key")
    @patch("cryptography.hazmat.primitives.serialization.load_pem_public_key")
    def test_services_verify_signature(self, mock_load_pem, mock_get_pubkey):
        mock_get_pubkey.return_value = "some-pem"
        mock_pubkey_obj = MagicMock()
        mock_load_pem.return_value = mock_pubkey_obj

        res = MonobankService.verify_signature("dGVzdC1zaWduYXR1cmU=", b"body")
        self.assertTrue(res)

        res = MonobankService.verify_signature("invalid-b64-!!!", b"body")
        self.assertFalse(res)

        res = MonobankService.verify_signature(None, b"body")
        self.assertFalse(res)

        mock_pubkey_obj.verify.side_effect = Exception("Invalid signature")
        res = MonobankService.verify_signature("dGVzdC1zaWduYXR1cmU=", b"body")
        self.assertFalse(res)

    # ── Views Tests ──
    def test_invoice_create_validation_errors(self):
        self._login(self.coach)

        response = self.client.post(
            "/api/billing/invoices/", {"payment_type": "registrations"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("redirect_url", response.data["detail"])

        response = self.client.post(
            "/api/billing/invoices/",
            {"payment_type": "registrations", "redirect_url": "http://success"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("registration_ids", response.data["detail"])

        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [99999],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.category.registration_fee = 0
        self.category.save()
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [self.reg.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.category.registration_fee = 500
        self.category.save()

        self.reg.status = Registration.Status.REJECTED
        self.reg.save()
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [self.reg.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.reg.status = Registration.Status.PENDING
        self.reg.payment_status = "paid"
        self.reg.save()
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [self.reg.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            "/api/billing/invoices/",
            {"payment_type": "unknown_type", "redirect_url": "http://success"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invoice_create_permission_denied(self):
        self._login(self.coach_other)

        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [self.reg.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @patch("apps.billing.services.MonobankService.create_invoice")
    def test_invoice_create_monobank_failure(self, mock_create):
        self._login(self.coach)
        mock_create.side_effect = Exception("API offline")

        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "registrations",
                "redirect_url": "http://success",
                "registration_ids": [self.reg.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        inv = PaymentInvoice.objects.filter(user=self.coach).first()
        self.assertEqual(inv.status, PaymentInvoice.Status.FAILED)

    def test_invoice_create_platform_fee_validation_and_permissions(self):
        self._login(self.coach)
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "platform_fee",
                "redirect_url": "http://success",
                "tournament_id": self.tournament.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self._login(self.organizer)
        with patch("apps.billing.services.MonobankService.create_invoice") as mock_create:
            mock_create.return_value = {"invoiceId": "mono-fee", "pageUrl": "http://mono-pay"}
            response = self.client.post(
                "/api/billing/invoices/",
                {
                    "payment_type": "platform_fee",
                    "redirect_url": "http://success",
                    "tournament_id": self.tournament.id,
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            self.assertEqual(response.data["amount"], 1000)

        self.tournament.platform_fee_status = "paid"
        self.tournament.save()
        response = self.client.post(
            "/api/billing/invoices/",
            {
                "payment_type": "platform_fee",
                "redirect_url": "http://success",
                "tournament_id": self.tournament.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.tournament.platform_fee_status = "unpaid"
        self.tournament.save()
        with patch("apps.billing.services.MonobankService.create_invoice") as mock_create:
            mock_create.side_effect = Exception("API connection timed out")
            response = self.client.post(
                "/api/billing/invoices/",
                {
                    "payment_type": "platform_fee",
                    "redirect_url": "http://success",
                    "tournament_id": self.tournament.id,
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

    def test_invoice_sync_status_views(self):
        self._login(self.coach)
        invoice = PaymentInvoice.objects.create(
            user=self.coach,
            amount=500,
            status=PaymentInvoice.Status.PENDING,
            invoice_id="mono-sync-id",
        )
        invoice.registrations.add(self.reg)

        invoice.status = PaymentInvoice.Status.PAID
        invoice.save()
        response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("лише для очікуючих рахунків", response.data["detail"])

        invoice.status = PaymentInvoice.Status.PENDING
        invoice.invoice_id = None
        invoice.save()

        response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("не містить ID платіжної системи", response.data["detail"])

        invoice.invoice_id = "mono-sync-id"
        invoice.save()

        with patch("apps.billing.services.MonobankService.get_invoice_status") as mock_status:
            mock_status.return_value = {"status": "expired"}
            response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            invoice.refresh_from_db()
            self.assertEqual(invoice.status, PaymentInvoice.Status.EXPIRED)

        invoice.status = PaymentInvoice.Status.PENDING
        invoice.save()

        with patch("apps.billing.services.MonobankService.get_invoice_status") as mock_status:
            mock_status.return_value = {
                "status": "success",
                "paymentInfos": [{"receiptId": "MN-SYNC-REC"}],
            }
            response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            invoice.refresh_from_db()
            self.assertEqual(invoice.status, PaymentInvoice.Status.PAID)
            self.reg.refresh_from_db()
            self.assertEqual(self.reg.payment_status, "paid")

        invoice.status = PaymentInvoice.Status.PENDING
        invoice.save()

        with patch("apps.billing.services.MonobankService.get_invoice_status") as mock_status:
            mock_status.return_value = {"status": "created"}
            response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn("не змінився", response.data["detail"])

        with patch("apps.billing.services.MonobankService.get_invoice_status") as mock_status:
            mock_status.side_effect = Exception("HTTP 502")
            response = self.client.post(f"/api/billing/invoices/{invoice.id}/sync/")
            self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

    @patch("apps.billing.services.MonobankService.verify_signature")
    def test_webhook_invalid_signature_and_payload(self, mock_verify):
        mock_verify.return_value = False
        response = self.client.post(
            "/api/billing/webhook/monobank/", {"invoiceId": "mono-123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Недійсний підпис X-Sign", response.data["detail"])

        mock_verify.return_value = True

        response = self.client.post("/api/billing/webhook/monobank/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Відсутній invoiceId", response.data["detail"])

        response = self.client.post(
            "/api/billing/webhook/monobank/", {"invoiceId": "missing-invoice-id"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("Інвойс не знайдено", response.data["detail"])

    @patch("apps.billing.services.MonobankService.verify_signature")
    def test_webhook_status_processing(self, mock_verify):
        mock_verify.return_value = True

        invoice = PaymentInvoice.objects.create(
            user=self.coach,
            amount=500,
            status=PaymentInvoice.Status.PENDING,
            invoice_id="mono-webhook-id",
        )
        invoice.registrations.add(self.reg)

        response = self.client.post(
            "/api/billing/webhook/monobank/",
            {"invoiceId": "mono-webhook-id", "status": "failure"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, PaymentInvoice.Status.EXPIRED)

        invoice.status = PaymentInvoice.Status.PENDING
        invoice.save()

        response = self.client.post(
            "/api/billing/webhook/monobank/",
            {"invoiceId": "mono-webhook-id", "status": "success"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, PaymentInvoice.Status.PAID)
        tx = Transaction.objects.get(invoice=invoice)
        self.assertEqual(tx.receipt_url, "https://www.monobank.ua/receipts/demo-sandbox-receipt")

        invoice.status = PaymentInvoice.Status.PENDING
        invoice.save()

        with patch("apps.billing.views.process_successful_payment") as mock_process:
            mock_process.side_effect = TypeError("Mocked DB collision")
            response = self.client.post(
                "/api/billing/webhook/monobank/",
                {"invoiceId": "mono-webhook-id", "status": "success"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

    def test_transaction_queryset_permissions(self):
        self._login(self.admin)
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self._login(self.coach)
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_payout_request_validation_and_completion(self):
        # 1. Спроба створити запит на виплату для незавершеного турніру
        self.tournament.status = "active"
        self.tournament.save()
        self._login(self.organizer)
        response = self.client.post(
            "/api/billing/payout-requests/",
            {
                "tournament": self.tournament.id,
                "amount": 1000,
                "bank_details": "UA1234567890",
                "iban": "UA1234567890",
                "recipient_name": "Іванов Іван Іванович",
                "recipient_code": "1234567890",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Виведення коштів доступне лише для завершених турнірів", str(response.data))

        # 2. Спроба створити запит на виплату для завершеного турніру
        self.tournament.status = "completed"
        self.tournament.save()
        response = self.client.post(
            "/api/billing/payout-requests/",
            {
                "tournament": self.tournament.id,
                "amount": 1000,
                "bank_details": "UA1234567890",
                "iban": "UA1234567890",
                "recipient_name": "Іванов Іван Іванович",
                "recipient_code": "1234567890",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payout_id = response.data["id"]

        # 3. Адмін підтверджує виплату -> статус боргу автоматично змінюється на paid
        self.tournament.platform_fee_status = "unpaid"
        self.tournament.save()
        self._login(self.admin)
        response = self.client.patch(
            f"/api/billing/payout-requests/{payout_id}/", {"status": "completed"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.tournament.refresh_from_db()
        self.assertEqual(self.tournament.platform_fee_status, "paid")
