from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.billing.views import (
    InvoiceViewSet,
    MonobankWebhookView,
    PayoutRequestViewSet,
    TransactionViewSet,
)

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("transactions", TransactionViewSet, basename="transaction")
router.register("payout-requests", PayoutRequestViewSet, basename="payout-request")

urlpatterns = [
    path("", include(router.urls)),
    path("webhook/monobank/", MonobankWebhookView.as_view(), name="monobank-webhook"),
]
