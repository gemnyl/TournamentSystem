from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.accounts.models import RoleRequest
from apps.common.admin import BaseTournamentAdminMixin, dashboard_callback
from apps.matches.models import Match
from apps.tournaments.models import Category, Tournament

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


class MockAdmin(BaseTournamentAdminMixin):
    pass


class BaseTournamentAdminMixinTest(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.admin = MockAdmin()
        self.superuser = User.objects.create_superuser(email="super2@test.com", password="password")
        self.admin_user = User.objects.create_user(
            email="admin2@test.com", password="password", role=User.Role.ADMIN
        )
        self.organizer = User.objects.create_user(
            email="org2@test.com", password="password", role=User.Role.ORGANIZER
        )
        self.judge = User.objects.create_user(
            email="judge2@test.com", password="password", role=User.Role.JUDGE
        )
        self.coach = User.objects.create_user(
            email="coach2@test.com", password="password", role=User.Role.COACH
        )

        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            chief_judge=self.judge,
            title="Test Tournament 2",
            sport_type="Judo",
            location="Lviv",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
            status=Tournament.Status.ACTIVE,
        )
        self.category = Category.objects.create(
            tournament=self.tournament,
            name="Test Cat",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=10,
            max_age=99,
            min_weight=10,
            max_weight=150,
        )
        self.match = Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=1,
        )

    def test_has_module_permission(self):
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        self.assertTrue(self.admin.has_module_permission(req))

        # Admin
        req.user = self.admin_user
        self.assertTrue(self.admin.has_module_permission(req))

        # Organizer
        req.user = self.organizer
        self.assertTrue(self.admin.has_module_permission(req))

        # Judge
        req.user = self.judge
        self.assertTrue(self.admin.has_module_permission(req))

        # Coach (should be False)
        req.user = self.coach
        self.assertFalse(self.admin.has_module_permission(req))

        # Anonymous
        req.user = None
        self.assertFalse(self.admin.has_module_permission(req))

    def test_resolve_tournament(self):
        # Directly tournament
        self.assertEqual(self.admin._resolve_tournament(self.tournament), self.tournament)

        # Object with category -> tournament
        class TempCatObj:
            def __init__(self, category):
                self.category = category

        self.assertEqual(self.admin._resolve_tournament(TempCatObj(self.category)), self.tournament)

        # Object with match -> category -> tournament
        class TempMatchObj:
            def __init__(self, match):
                self.match = match

        self.assertEqual(self.admin._resolve_tournament(TempMatchObj(self.match)), self.tournament)

        # None / other
        self.assertIsNone(self.admin._resolve_tournament(None))
        self.assertIsNone(self.admin._resolve_tournament(object()))

    def test_has_change_permission(self):
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        self.assertTrue(self.admin.has_change_permission(req, self.tournament))

        # Admin
        req.user = self.admin_user
        self.assertTrue(self.admin.has_change_permission(req, self.tournament))

        # obj is None -> check role
        req.user = self.organizer
        self.assertTrue(self.admin.has_change_permission(req, None))
        req.user = self.coach
        self.assertFalse(self.admin.has_change_permission(req, None))

        # obj is tournament -> check organizer and chief judge
        req.user = self.organizer
        self.assertTrue(self.admin.has_change_permission(req, self.tournament))
        req.user = self.judge
        self.assertTrue(self.admin.has_change_permission(req, self.tournament))
        req.user = self.coach
        self.assertFalse(self.admin.has_change_permission(req, self.tournament))

    def test_has_delete_permission(self):
        req = self.factory.get("/admin/")
        req.user = self.organizer
        self.assertTrue(self.admin.has_delete_permission(req, self.tournament))

    def test_has_add_permission(self):
        req = self.factory.get("/admin/")

        # Organizer
        req.user = self.organizer
        self.assertTrue(self.admin.has_add_permission(req))

        # Coach
        req.user = self.coach
        self.assertFalse(self.admin.has_add_permission(req))
