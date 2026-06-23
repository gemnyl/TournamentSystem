from rest_framework import serializers

from apps.billing.models import PaymentInvoice, PayoutRequest, Transaction


class InvoiceSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    payment_type_display = serializers.CharField(source="get_payment_type_display", read_only=True)
    registration_details = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = PaymentInvoice
        fields = [
            "id",
            "invoice_id",
            "payment_type",
            "payment_type_display",
            "amount",
            "status",
            "status_display",
            "payment_url",
            "registrations",
            "registration_details",
            "tournament",
            "tournaments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "invoice_id", "payment_url", "created_at", "updated_at"]

    def get_registration_details(self, obj):
        details = []
        for r in obj.registrations.select_related("athlete", "category", "team").all():
            name = ""
            if r.athlete:
                name = f"{r.athlete.last_name} {r.athlete.first_name}"
            elif r.team:
                name = r.team.name
            details.append(
                {
                    "id": r.id,
                    "athlete_name": name,
                    "category_name": r.category.name if r.category else "",
                }
            )
        return details


class TransactionSerializer(serializers.ModelSerializer):
    payer_name = serializers.CharField(source="user.get_full_name", read_only=True)
    method_display = serializers.CharField(source="get_method_display", read_only=True)
    transaction_type_display = serializers.CharField(
        source="get_transaction_type_display", read_only=True
    )
    payment_type_display = serializers.CharField(source="get_payment_type_display", read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id",
            "invoice",
            "user",
            "payer_name",
            "payment_type",
            "payment_type_display",
            "transaction_type",
            "transaction_type_display",
            "amount",
            "method",
            "method_display",
            "reference",
            "monobank_receipt_id",
            "receipt_url",
            "requires_refund",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "reference",
            "monobank_receipt_id",
            "receipt_url",
            "requires_refund",
            "created_at",
        ]


class PayoutRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    organizer_name = serializers.CharField(source="organizer.get_full_name", read_only=True)
    tournament_title = serializers.CharField(source="tournament.title", read_only=True)

    class Meta:
        model = PayoutRequest
        fields = [
            "id",
            "tournament",
            "tournament_title",
            "organizer",
            "organizer_name",
            "amount",
            "bank_details",
            "iban",
            "recipient_name",
            "recipient_code",
            "purpose",
            "status",
            "status_display",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "organizer", "created_at", "updated_at"]

    def validate(self, attrs):
        if not self.instance:
            if not attrs.get("iban"):
                raise serializers.ValidationError({"iban": "Це поле є обов'язковим."})
            if not attrs.get("recipient_name"):
                raise serializers.ValidationError({"recipient_name": "Це поле є обов'язковим."})
            if not attrs.get("recipient_code"):
                raise serializers.ValidationError({"recipient_code": "Це поле є обов'язковим."})
        return attrs
