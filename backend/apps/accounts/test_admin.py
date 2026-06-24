from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.accounts.admin import RoleRequestAdmin
from apps.accounts.models import RoleRequest

User = get_user_model()


class AccountsAdminTest(TestCase):
    def setUp(self):
        self.site = AdminSite()
        self.factory = RequestFactory()
        self.superuser = User.objects.create_superuser(email="super@test.com", password="password")
        self.user = User.objects.create_user(
            email="user@test.com", password="password", role=User.Role.SPECTATOR
        )
        self.req = RoleRequest.objects.create(
            user=self.user,
            requested_role=User.Role.COACH,
            status=RoleRequest.Status.PENDING,
        )

    def test_approve_requests(self):
        admin = RoleRequestAdmin(RoleRequest, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        from django.contrib.messages.storage.cookie import CookieStorage

        req._messages = CookieStorage(req)

        # Run action
        qs = RoleRequest.objects.filter(id=self.req.id)
        admin.approve_requests(req, qs)

        self.req.refresh_from_db()
        self.assertEqual(self.req.status, RoleRequest.Status.APPROVED)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, User.Role.COACH)

    def test_reject_requests(self):
        admin = RoleRequestAdmin(RoleRequest, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        from django.contrib.messages.storage.cookie import CookieStorage

        req._messages = CookieStorage(req)

        # Run action
        qs = RoleRequest.objects.filter(id=self.req.id)
        admin.reject_requests(req, qs)

        self.req.refresh_from_db()
        self.assertEqual(self.req.status, RoleRequest.Status.REJECTED)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, User.Role.SPECTATOR)  # Unchanged
