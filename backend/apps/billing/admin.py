from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.decorators import action, display

from apps.billing.models import PaymentInvoice, PayoutRequest, Transaction


@admin.register(PaymentInvoice)
class PaymentInvoiceAdmin(UnfoldModelAdmin):
    list_select_related = ["user", "tournament"]
    autocomplete_fields = ["user", "tournament"]

    list_display = (
        "id",
        "user",
        "payment_type",
        "amount",
        "status_badge",
        "invoice_id",
        "created_at",
    )
    list_display_links = ("id", "user")
    list_filter = ("status", "payment_type", "created_at")
    search_fields = ("user__email", "user__first_name", "user__last_name", "invoice_id")
    readonly_fields = ("created_at", "updated_at")
    filter_horizontal = ("registrations", "tournaments")

    actions_list = ["mass_mark_paid"]

    @display(
        description="Статус",
        label={
            "paid": "success",
            "pending": "warning",
            "expired": "danger",
            "failed": "danger",
        },
    )
    def status_badge(self, obj):
        return obj.status

    @action(description="Позначити як сплачений", icon="check_circle")
    def mass_mark_paid(self, request, queryset):
        updated = queryset.update(status=PaymentInvoice.Status.PAID)
        self.message_user(request, f"Успішно оновлено статус для {updated} рахунків на 'Сплачено'.")


@admin.register(Transaction)
class TransactionAdmin(UnfoldModelAdmin):
    list_select_related = ["user", "invoice"]
    autocomplete_fields = ["user", "invoice"]

    list_display = (
        "reference",
        "user",
        "payment_type",
        "transaction_type_badge",
        "amount",
        "method",
        "monobank_receipt_id",
        "requires_refund_badge",
        "created_at",
    )
    list_display_links = ("reference",)
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

    @display(
        description="Тип транзакції",
        label={
            "payment": "success",
            "refund": "info",
        },
    )
    def transaction_type_badge(self, obj):
        return obj.transaction_type

    @display(
        description="Потребує повернення",
        label={
            True: "danger",
            False: "success",
        },
    )
    def requires_refund_badge(self, obj):
        return obj.requires_refund


@admin.register(PayoutRequest)
class PayoutRequestAdmin(UnfoldModelAdmin):
    list_select_related = ["tournament", "organizer"]
    autocomplete_fields = ["tournament", "organizer"]

    list_display = (
        "id",
        "tournament",
        "organizer",
        "amount",
        "purpose",
        "status_badge",
        "created_at",
    )
    list_display_links = ("id", "tournament")
    list_filter = ("status", "created_at")
    search_fields = (
        "tournament__title",
        "organizer__email",
        "recipient_name",
        "iban",
    )
    readonly_fields = ("created_at", "updated_at")

    actions_list = ["confirm_payout", "reject_payout"]

    @display(
        description="Статус",
        label={
            "pending": "warning",
            "completed": "success",
            "rejected": "danger",
        },
    )
    def status_badge(self, obj):
        return obj.status

    @action(description="Підтвердити виплату", icon="check_circle")
    def confirm_payout(self, request, queryset):
        updated = queryset.update(status=PayoutRequest.Status.COMPLETED)
        self.message_user(request, f"Успішно підтверджено {updated} виплат.")

    @action(description="Відхилити виплату", icon="cancel")
    def reject_payout(self, request, queryset):
        updated = queryset.update(status=PayoutRequest.Status.REJECTED)
        self.message_user(request, f"Відхилено {updated} виплат.")
