from django.contrib import admin

from apps.billing.models import PaymentInvoice, Transaction


@admin.register(PaymentInvoice)
class PaymentInvoiceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "payment_type",
        "amount",
        "status",
        "invoice_id",
        "created_at",
    )
    list_filter = ("status", "payment_type", "created_at")
    search_fields = ("user__email", "user__first_name", "user__last_name", "invoice_id")
    readonly_fields = ("created_at", "updated_at")
    filter_horizontal = ("registrations",)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "reference",
        "user",
        "payment_type",
        "transaction_type",
        "amount",
        "method",
        "monobank_receipt_id",
        "requires_refund",
        "created_at",
    )
    list_filter = (
        "payment_type",
        "transaction_type",
        "method",
        "requires_refund",
        "created_at",
    )
    search_fields = (
        "user__email",
        "user__first_name",
        "user__last_name",
        "reference",
        "monobank_receipt_id",
    )
    readonly_fields = ("created_at",)
