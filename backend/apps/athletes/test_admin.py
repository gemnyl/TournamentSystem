import datetime

from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.accounts.models import Club
from apps.athletes.admin import (
    AthleteAdmin,
    AthleteWeightLogAdmin,
    AthleteWeightLogInline,
)
from apps.athletes.models import Athlete, AthleteWeightLog

User = get_user_model()


class AthletesAdminTest(TestCase):
    def setUp(self):
        self.site = AdminSite()
        self.factory = RequestFactory()

        self.superuser = User.objects.create_superuser(email="super@test.com", password="password")
        self.coach = User.objects.create_user(
            email="coach@test.com", password="password", role=User.Role.COACH
        )
        self.club = Club.objects.create(name="Test Club", region="Kyiv")

        self.athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Ivan",
            last_name="Ivanov",
            birth_date=datetime.date(2000, 1, 1),
            gender="male",
            base_weight=70.0,
        )

        self.log = AthleteWeightLog.objects.create(
            athlete=self.athlete,
            weight=71.5,
            notes="Weigh-in notes",
        )

    def test_athlete_admin_display_fields(self):
        admin = AthleteAdmin(Athlete, self.site)
        self.assertEqual(admin.pib(self.athlete), "Ivanov Ivan")
        self.assertEqual(admin.age(self.athlete), self.athlete.calculate_current_age())

    def test_athlete_weight_log_inline_permissions(self):
        inline = AthleteWeightLogInline(Athlete, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        self.assertFalse(inline.has_add_permission(req, self.athlete))
        self.assertFalse(inline.has_change_permission(req, self.athlete))
        self.assertFalse(inline.has_delete_permission(req, self.athlete))

    def test_athlete_weight_log_admin_permissions(self):
        admin = AthleteWeightLogAdmin(AthleteWeightLog, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        self.assertFalse(admin.has_add_permission(req))
        self.assertFalse(admin.has_change_permission(req, self.log))
        self.assertFalse(admin.has_delete_permission(req, self.log))
