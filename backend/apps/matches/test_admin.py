from django.contrib.auth import get_user_model

from apps.matches.admin import IsUndoFilter, MatchAdmin, MatchEventAdmin, MatchEventInline
from apps.matches.models import Match, MatchEvent
from apps.tatamis.models import Tatami
from apps.tournaments.test_admin import BaseAdminTest

User = get_user_model()


class MatchesAdminTest(BaseAdminTest):
    def setUp(self):
        super().setUp()
        self.tatami = Tatami.objects.create(
            number=1,
            name="Tatami 1",
            tournament=self.t1,
            assigned_judge=self.judge,
        )

        self.match = Match.objects.create(
            category=self.cat,
            round_index=1,
            match_order=1,
            tatami=self.tatami,
        )

        self.event = MatchEvent.objects.create(
            match=self.match,
            event_type="SCORE",
            sequence=1,
            payload={"points": 1, "is_undo": False},
        )

        self.undo_event = MatchEvent.objects.create(
            match=self.match,
            event_type="UNDO",
            sequence=2,
            payload={"is_undo": True},
        )

    def test_match_admin_get_queryset(self):
        admin = MatchAdmin(Match, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        qs = admin.get_queryset(req)
        self.assertIn(self.match, qs)

        # Organizer
        req.user = self.organizer
        qs = admin.get_queryset(req)
        self.assertIn(self.match, qs)

        # Judge
        req.user = self.judge
        qs = admin.get_queryset(req)
        self.assertIn(self.match, qs)

        # Spectator
        req.user = self.spectator
        qs = admin.get_queryset(req)
        self.assertNotIn(self.match, qs)

    def test_match_admin_save_model(self):
        admin = MatchAdmin(Match, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        admin.save_model(req, self.match, None, change=True)

    def test_match_event_inline_permissions(self):
        inline = MatchEventInline(Match, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        self.assertFalse(inline.has_add_permission(req, self.match))
        self.assertFalse(inline.has_change_permission(req, self.match))
        self.assertFalse(inline.has_delete_permission(req, self.match))

    def test_is_undo_filter(self):
        # Lookups
        filter_instance = IsUndoFilter(None, {"is_undo": ["true"]}, MatchEvent, MatchEventAdmin)
        lookups = filter_instance.lookups(None, None)
        self.assertEqual(len(lookups), 2)

        # Queryset with 'true'
        qs = filter_instance.queryset(None, MatchEvent.objects.all())
        self.assertIn(self.undo_event, qs)
        self.assertNotIn(self.event, qs)

        # Queryset with 'false'
        filter_instance = IsUndoFilter(None, {"is_undo": ["false"]}, MatchEvent, MatchEventAdmin)
        qs = filter_instance.queryset(None, MatchEvent.objects.all())
        self.assertIn(self.event, qs)
        self.assertNotIn(self.undo_event, qs)

        # Queryset with None
        filter_instance = IsUndoFilter(None, {}, MatchEvent, MatchEventAdmin)
        qs = filter_instance.queryset(None, MatchEvent.objects.all())
        self.assertEqual(qs.count(), 2)

    def test_match_event_admin_get_queryset(self):
        admin = MatchEventAdmin(MatchEvent, self.site)
        req = self.factory.get("/admin/")

        # Superuser
        req.user = self.superuser
        qs = admin.get_queryset(req)
        self.assertIn(self.event, qs)

        # Organizer
        req.user = self.organizer
        qs = admin.get_queryset(req)
        self.assertIn(self.event, qs)

        # Judge
        req.user = self.judge
        qs = admin.get_queryset(req)
        self.assertIn(self.event, qs)

        # Spectator
        req.user = self.spectator
        qs = admin.get_queryset(req)
        self.assertNotIn(self.event, qs)

    def test_match_event_admin_displays(self):
        admin = MatchEventAdmin(MatchEvent, self.site)
        self.assertEqual(admin.get_tournament(self.event), self.t1.title)
        self.assertEqual(admin.get_category(self.event), self.cat.name)
        from django.utils.timezone import localtime

        expected_time = localtime(self.event.created_at).strftime("%d.%m.%Y %H:%M:%S")
        self.assertEqual(admin.timestamp(self.event), expected_time)

    def test_match_event_admin_permissions(self):
        admin = MatchEventAdmin(MatchEvent, self.site)
        req = self.factory.get("/admin/")
        req.user = self.superuser
        self.assertFalse(admin.has_add_permission(req))
        self.assertFalse(admin.has_change_permission(req, self.event))
        self.assertFalse(admin.has_delete_permission(req, self.event))
