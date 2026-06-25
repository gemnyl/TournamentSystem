from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.contrib.messages.storage.cookie import CookieStorage
from django.test import RequestFactory, TestCase

from apps.accounts.models import Club
from apps.athletes.models import Athlete, Team
from apps.matches.models import Match
from apps.tatamis.models import Tatami
from apps.tournaments.admin import CategoryAdmin, RegistrationAdmin, TournamentAdmin
from apps.tournaments.models import Category, Registration, Tournament

User = get_user_model()


class BaseAdminTest(TestCase):
    def setUp(self):
        super().setUp()
        self.site = AdminSite()
        self.factory = RequestFactory()

        # Create common users
        self.superuser = User.objects.create_superuser(email="super@test.com", password="password")
        self.organizer1 = User.objects.create_user(
            email="org1@test.com", password="password", role=User.Role.ORGANIZER
        )
        self.organizer = self.organizer1
        self.judge = User.objects.create_user(
            email="judge@test.com", password="password", role=User.Role.JUDGE
        )
        self.spectator = User.objects.create_user(
            email="spec@test.com", password="password", role=User.Role.SPECTATOR
        )

        # Create common tournament
        self.t1 = Tournament.objects.create(
            organizer=self.organizer1,
            title="Tournament 1",
            sport_type="Karate",
            location="Kyiv",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
        )

        # Create common category
        self.cat = Category.objects.create(
            tournament=self.t1,
            name="Category 1",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=34,
            min_weight=60.0,
            max_weight=80.0,
        )


class TournamentAdminTest(BaseAdminTest):
    def setUp(self):
        super().setUp()
        self.organizer2 = User.objects.create_user(
            email="org2@test.com", password="password", role=User.Role.ORGANIZER
        )
        self.t2 = Tournament.objects.create(
            organizer=self.organizer2,
            title="Tournament 2",
            sport_type="Judo",
            location="Lviv",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
        )

    def test_tournament_admin_get_queryset(self):
        admin = TournamentAdmin(Tournament, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        qs = admin.get_queryset(req)
        self.assertEqual(qs.count(), 2)

        # Organizer 1
        req.user = self.organizer1
        qs = admin.get_queryset(req)
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first(), self.t1)

        # Judge (not assigned to any tatami)
        req.user = self.judge
        qs = admin.get_queryset(req)
        self.assertEqual(qs.count(), 0)

        # Judge (assigned to tatami in t1)
        Tatami.objects.create(
            number=1,
            name="Tatami 1",
            tournament=self.t1,
            assigned_judge=self.judge,
        )
        req.user = self.judge
        qs = admin.get_queryset(req)
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first(), self.t1)

    def test_tournament_admin_has_delete_permission(self):
        admin = TournamentAdmin(Tournament, self.site)
        req = self.factory.get("/admin/")

        # Superuser always can delete
        req.user = self.superuser
        self.assertTrue(admin.has_delete_permission(req, self.t1))

        # Organizer 1 can delete their own tournament if no brackets/registrations paid
        req.user = self.organizer1
        self.assertTrue(admin.has_delete_permission(req, self.t1))

        # Organizer 1 cannot delete Organizer 2's tournament
        self.assertFalse(admin.has_delete_permission(req, self.t2))

        # Create paid registration -> cannot delete
        reg = Registration.objects.create(
            category=self.cat,
            payment_status="paid",
            status=Registration.Status.CONFIRMED,
        )
        self.assertFalse(admin.has_delete_permission(req, self.t1))

        # Reset payment -> can delete
        reg.payment_status = "unpaid"
        reg.save()
        self.assertTrue(admin.has_delete_permission(req, self.t1))

        # Create match (brackets generated) -> cannot delete
        Match.objects.create(
            category=self.cat,
            round_index=1,
            match_order=1,
        )
        self.assertFalse(admin.has_delete_permission(req, self.t1))

        # Judge cannot delete tournament (obj is provided)
        req.user = self.judge
        self.assertFalse(admin.has_delete_permission(req, self.t1))

        # Test when obj is None (e.g. check for list view delete action permission)
        # Organizer should have delete permission overall
        req.user = self.organizer1
        self.assertTrue(admin.has_delete_permission(req, None))

        # Judge should not have delete permission overall
        req.user = self.judge
        self.assertFalse(admin.has_delete_permission(req, None))

    def test_tournament_admin_actions(self):
        admin = TournamentAdmin(Tournament, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        req._messages = CookieStorage(req)

        # Test open_registration action (succeeds on DRAFT)
        self.assertEqual(self.t1.status, Tournament.Status.DRAFT)
        qs = Tournament.objects.filter(id=self.t1.id)
        admin.open_registration(req, qs)
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.status, Tournament.Status.REGISTRATION)

        # Test open_registration action validation error (fails on REGISTRATION)
        admin.open_registration(req, qs)

        # Test start_tournament action (succeeds on REGISTRATION)
        admin.start_tournament(req, qs)
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.status, Tournament.Status.ACTIVE)

        # Test start_tournament action validation error (fails on ACTIVE)
        admin.start_tournament(req, qs)


class CategoryAdminTest(BaseAdminTest):
    def test_category_admin_get_queryset(self):
        admin = CategoryAdmin(Category, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        self.assertEqual(admin.get_queryset(req).count(), 1)

        # Organizer 1
        req.user = self.organizer1
        self.assertEqual(admin.get_queryset(req).count(), 1)

        # Judge (assigned to tatami in t1)
        Tatami.objects.create(
            number=1,
            name="Tatami 1",
            tournament=self.t1,
            assigned_judge=self.judge,
        )
        req.user = self.judge
        self.assertEqual(admin.get_queryset(req).count(), 1)

    def test_category_admin_display_fields(self):
        admin = CategoryAdmin(Category, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser

        # Get annotated queryset object
        qs = admin.get_queryset(req)
        cat_obj = qs.get(id=self.cat.id)

        # Test participants count
        self.assertEqual(admin.participants_count_display(cat_obj), 0)

        # Test age range
        self.assertEqual(admin.age_range(self.cat), "18 - 34")

        # Test weight range (with min/max set)
        self.assertEqual(admin.weight_range(self.cat), "60.0 - 80.0 кг")

        # Test weight range (with min/max as None)
        self.cat.min_weight = None
        self.cat.max_weight = None
        self.cat.save()
        self.assertEqual(admin.weight_range(self.cat), "0 - ∞ кг")


class RegistrationAdminTest(BaseAdminTest):
    def setUp(self):
        super().setUp()
        self.reg = Registration.objects.create(
            category=self.cat,
            payment_status="unpaid",
            status=Registration.Status.PENDING,
        )
        self.club = Club.objects.create(name="Club A", region="Kyiv")

    def test_registration_admin_get_queryset(self):
        admin = RegistrationAdmin(Registration, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        self.assertEqual(admin.get_queryset(req).count(), 1)

        # Organizer 1
        req.user = self.organizer1
        self.assertEqual(admin.get_queryset(req).count(), 1)

        # Judge (assigned to tatami in t1)
        Tatami.objects.create(
            number=1,
            name="Tatami 1",
            tournament=self.t1,
            assigned_judge=self.judge,
        )
        req.user = self.judge
        self.assertEqual(admin.get_queryset(req).count(), 1)

    def test_registration_admin_display_fields(self):
        admin = RegistrationAdmin(Registration, self.site)

        # Test participant_display when athlete is set
        athlete = Athlete.objects.create(
            coach=self.organizer1,
            club=self.club,
            first_name="Ivan",
            last_name="Ivanov",
            birth_date="2000-01-01",
            gender="male",
            base_weight=70.0,
        )
        self.reg.athlete = athlete
        self.reg.save()
        self.assertEqual(admin.participant_display(self.reg), "Ivanov Ivan")

        # Test participant_display when team is set
        team = Team.objects.create(name="Team A", coach=self.organizer1, club=self.club)
        self.reg.athlete = None
        self.reg.team = team
        self.reg.save()
        self.assertEqual(admin.participant_display(self.reg), "Команда: Team A")

        # Test participant_display when neither is set
        self.reg.team = None
        self.reg.save()
        self.assertEqual(admin.participant_display(self.reg), "TBD")

        # Test tournament display and badges
        self.assertEqual(admin.tournament_display(self.reg), self.t1.title)
        self.assertEqual(admin.status_badge(self.reg), self.reg.get_status_display())
        self.assertEqual(
            admin.payment_status_badge(self.reg), self.reg.get_payment_status_display()
        )

    def test_registration_admin_actions(self):
        admin = RegistrationAdmin(Registration, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        req._messages = CookieStorage(req)

        # Test mass_confirm_payment
        admin.mass_confirm_payment(req, Registration.objects.filter(id=self.reg.id))
        self.reg.refresh_from_db()
        self.assertEqual(self.reg.payment_status, "paid")

        # Test mass_confirm_weigh_in with athlete (succeeds)
        athlete = Athlete.objects.create(
            coach=self.organizer1,
            club=self.club,
            first_name="Ivan",
            last_name="Ivanov",
            birth_date="2000-01-01",
            gender="male",
            base_weight=70.0,
        )
        self.reg.athlete = athlete
        self.reg.status = Registration.Status.PENDING
        self.reg.save()
        admin.mass_confirm_weigh_in(req, Registration.objects.filter(id=self.reg.id))
        self.reg.refresh_from_db()
        self.assertEqual(self.reg.status, Registration.Status.CONFIRMED)

        # Test mass_confirm_weigh_in with athlete validation error (weight outside range)
        self.reg.status = Registration.Status.PENDING
        self.reg.save()
        athlete.base_weight = 95.0
        athlete.save()
        admin.mass_confirm_weigh_in(req, Registration.objects.filter(id=self.reg.id))
        self.reg.refresh_from_db()
        self.assertEqual(self.reg.status, Registration.Status.PENDING)

        # Test mass_confirm_weigh_in with team (succeeds directly)
        team = Team.objects.create(name="Team A", coach=self.organizer1, club=self.club)
        self.reg.athlete = None
        self.reg.team = team
        self.reg.status = Registration.Status.PENDING
        self.reg.save()
        admin.mass_confirm_weigh_in(req, Registration.objects.filter(id=self.reg.id))
        self.reg.refresh_from_db()
        self.assertEqual(self.reg.status, Registration.Status.CONFIRMED)
