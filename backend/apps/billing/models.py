from django.conf import settings
from django.db import models


class PaymentInvoice(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Очікує оплати"
        PAID = "paid", "Сплачено"
        EXPIRED = "expired", "Скасовано/Термін закінчився"
        FAILED = "failed", "Помилка оплати"

    class PaymentType(models.TextChoices):
        REGISTRATIONS = "registrations", "Внески за участь"
        PLATFORM_FEE = "platform_fee", "Комісія платформи"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="billing_invoices",
        verbose_name="Платник",
    )
    invoice_id = models.CharField(
        max_length=100,
        unique=True,
        null=True,
        blank=True,
        verbose_name="ID інвойсу Monobank",
    )
    payment_type = models.CharField(
        max_length=20,
        choices=PaymentType.choices,
        default=PaymentType.REGISTRATIONS,
        verbose_name="Тип оплати",
    )
    amount = models.PositiveIntegerField(verbose_name="Сума до сплати (UAH)")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        verbose_name="Статус",
    )

    # Зв'язки
    registrations = models.ManyToManyField(
        "tournaments.Registration",
        blank=True,
        related_name="payment_invoices",
        verbose_name="Реєстрації",
    )
    tournament = models.ForeignKey(
        "tournaments.Tournament",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fee_invoices",
        verbose_name="Турнір",
    )
    tournaments = models.ManyToManyField(
        "tournaments.Tournament",
        blank=True,
        related_name="bulk_fee_invoices",
        verbose_name="Турніри для оплати комісії",
    )

    payment_url = models.URLField(
        max_length=500, default="", blank=True, verbose_name="Посилання на оплату"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Створено")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Оновлено")

    class Meta:
        db_table = "billing_payment_invoice"
        verbose_name = "Рахунок на оплату"
        verbose_name_plural = "Рахунки на оплату"
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Рахунок #{self.id} ({self.get_payment_type_display()}) - "
            f"{self.amount} UAH [{self.get_status_display()}]"
        )


class Transaction(models.Model):
    class Method(models.TextChoices):
        ONLINE = "online", "Онлайн (Monobank)"
        OFFLINE = "offline", "Офлайн (Готівка)"

    class Type(models.TextChoices):
        PAYMENT = "payment", "Оплата"
        REFUND = "refund", "Повернення"

    invoice = models.ForeignKey(
        PaymentInvoice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
        verbose_name="Рахунок",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="transactions",
        verbose_name="Платник",
    )
    payment_type = models.CharField(
        max_length=20,
        choices=PaymentInvoice.PaymentType.choices,
        verbose_name="Тип оплати",
    )
    transaction_type = models.CharField(
        max_length=20,
        choices=Type.choices,
        default=Type.PAYMENT,
        verbose_name="Тип транзакції",
    )
    amount = models.IntegerField(verbose_name="Сума (UAH)")  # Може бути від'ємною при поверненні
    method = models.CharField(
        max_length=20,
        choices=Method.choices,
        default=Method.ONLINE,
        verbose_name="Спосіб оплати",
    )
    reference = models.CharField(max_length=100, unique=True, verbose_name="Референс транзакції")
    monobank_receipt_id = models.CharField(
        max_length=100,
        default="",
        blank=True,
        verbose_name="ID квитанції Monobank",
    )
    receipt_url = models.URLField(
        max_length=500,
        default="",
        blank=True,
        verbose_name="Посилання на офіційну квитанцію",
    )
    requires_refund = models.BooleanField(
        default=False,
        verbose_name="Потребує повернення",
        help_text="Флаг конфлікту оплати (подвійний платіж)",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Дата транзакції")

    class Meta:
        db_table = "billing_transaction"
        verbose_name = "Транзакція"
        verbose_name_plural = "Транзакції"
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Транзакція {self.reference} ({self.get_transaction_type_display()}) - "
            f"{self.amount} UAH"
        )


class PayoutRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Очікує обробки"
        COMPLETED = "completed", "Виплачено"
        REJECTED = "rejected", "Відхилено"

    tournament = models.ForeignKey(
        "tournaments.Tournament",
        on_delete=models.CASCADE,
        related_name="payout_requests",
        verbose_name="Турнір",
    )
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payout_requests",
        verbose_name="Організатор",
    )
    amount = models.PositiveIntegerField(verbose_name="Сума виплати (UAH)")
    bank_details = models.CharField(
        max_length=255,
        default="",
        blank=True,
        verbose_name="Банківські реквізити (Картка/Реквізити)",
    )
    iban = models.CharField(max_length=34, default="", blank=True, verbose_name="IBAN отримувача")
    recipient_name = models.CharField(
        max_length=255, default="", blank=True, verbose_name="ПІБ отримувача / Назва організації"
    )
    recipient_code = models.CharField(
        max_length=20, default="", blank=True, verbose_name="Код ЄДРПОУ / ІПН отримувача"
    )
    purpose = models.CharField(
        max_length=255, default="", blank=True, verbose_name="Призначення платежу"
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        verbose_name="Статус",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Створено")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Оновлено")

    class Meta:
        db_table = "billing_payout_request"
        verbose_name = "Запит на виплату"
        verbose_name_plural = "Запити на виплату"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Запит на виплату #{self.id} ({self.amount} UAH) - [{self.get_status_display()}]"
