from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.accounts.models import RoleRequest
from apps.common.admin import dashboard_callback
from apps.tournaments.models import Tournament

User = get_user_model()


class CommonAdminTest(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.superuser = User.objects.create_superuser(email="super@test.com", password="password")
        self.organizer = User.objects.create_user(
            email="org@test.com", password="password", role=User.Role.ORGANIZER
        )

        # Create tournament
        Tournament.objects.create(
            organizer=self.organizer,
            title="Test Tournament",
            sport_type="Judo",
            location="Kyiv",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
            status=Tournament.Status.ACTIVE,
        )

        # Create role request
        RoleRequest.objects.create(
            user=self.organizer, requested_role=User.Role.COACH, status=RoleRequest.Status.PENDING
        )

    def test_dashboard_callback(self):
        req = self.factory.get("/admin/")
        req.user = self.superuser
        context = {}
        res = dashboard_callback(req, context)

        self.assertEqual(res["active_tournaments_count"], 1)
        self.assertEqual(res["pending_role_requests_count"], 1)
        self.assertEqual(res["total_users_count"], 2)
        self.assertEqual(res["total_tournaments_count"], 1)
        self.assertIn("cpu_usage", res)
        self.assertIn("ram_usage", res)
        self.assertIn("db_connections", res)
