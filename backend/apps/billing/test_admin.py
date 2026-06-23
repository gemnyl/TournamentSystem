from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.billing.admin import PaymentInvoiceAdmin, PayoutRequestAdmin
from apps.billing.models import PaymentInvoice, PayoutRequest

User = get_user_model()


class BillingAdminTest(TestCase):
    def setUp(self):
        self.site = AdminSite()
        self.factory = RequestFactory()
        self.superuser = User.objects.create_superuser(email="super@test.com", password="password")
        self.user = User.objects.create_user(email="user@test.com", password="password")

        from apps.tournaments.models import Tournament

        self.tournament = Tournament.objects.create(
            organizer=self.user,
            title="Test Tournament",
            sport_type="Judo",
            location="Kyiv",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
        )

        self.invoice = PaymentInvoice.objects.create(
            user=self.user,
            amount=1000,
            status=PaymentInvoice.Status.PENDING,
            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
        )
        self.payout = PayoutRequest.objects.create(
            tournament=self.tournament,
            organizer=self.user,
            amount=5000,
            status=PayoutRequest.Status.PENDING,
            recipient_name="Test Name",
            iban="UA12345678901234567890123456",
            purpose="Payout",
        )

    def test_mass_mark_paid(self):
        admin = PaymentInvoiceAdmin(PaymentInvoice, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        from django.contrib.messages.storage.cookie import CookieStorage

        req._messages = CookieStorage(req)

        # Run action
        qs = PaymentInvoice.objects.filter(id=self.invoice.id)
        admin.mass_mark_paid(req, qs)

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, PaymentInvoice.Status.PAID)

    def test_confirm_payout(self):
        admin = PayoutRequestAdmin(PayoutRequest, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        from django.contrib.messages.storage.cookie import CookieStorage

        req._messages = CookieStorage(req)

        # Run action
        qs = PayoutRequest.objects.filter(id=self.payout.id)
        admin.confirm_payout(req, qs)

        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, PayoutRequest.Status.COMPLETED)

    def test_reject_payout(self):
        admin = PayoutRequestAdmin(PayoutRequest, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        from django.contrib.messages.storage.cookie import CookieStorage

        req._messages = CookieStorage(req)

        # Run action
        qs = PayoutRequest.objects.filter(id=self.payout.id)
        admin.reject_payout(req, qs)

        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, PayoutRequest.Status.REJECTED)
