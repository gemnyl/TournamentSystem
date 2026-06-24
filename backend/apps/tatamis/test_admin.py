from django.contrib.auth import get_user_model

from apps.tatamis.admin import TatamiAdmin
from apps.tatamis.models import Tatami
from apps.tournaments.test_admin import BaseAdminTest

User = get_user_model()


class TatamiAdminTest(BaseAdminTest):
    def setUp(self):
        super().setUp()
        self.tatami = Tatami.objects.create(
            number=1,
            name="Tatami 1",
            tournament=self.t1,
            assigned_judge=self.judge,
            scoreboard_connected=True,
        )

    def test_get_queryset(self):
        admin = TatamiAdmin(Tatami, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        qs = admin.get_queryset(req)
        self.assertIn(self.tatami, qs)

        # Organizer
        req.user = self.organizer
        qs = admin.get_queryset(req)
        self.assertIn(self.tatami, qs)

        # Judge
        req.user = self.judge
        qs = admin.get_queryset(req)
        self.assertIn(self.tatami, qs)

        # Spectator
        req.user = self.spectator
        qs = admin.get_queryset(req)
        self.assertNotIn(self.tatami, qs)

    def test_status_connection(self):
        admin = TatamiAdmin(Tatami, self.site)
        self.assertTrue(admin.status_connection(self.tatami))

    def test_save_model(self):
        admin = TatamiAdmin(Tatami, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        admin.save_model(req, self.tatami, None, change=True)
