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

    def test_get_event_description_all_types(self):
        from apps.matches.admin import _get_event_description

        # Test SCORE
        self.event.event_type = MatchEvent.EventType.SCORE
        self.event.payload = {"corner": "aka", "action_key": "yuko"}
        self.cat.ruleset_key = "karate_wkf"
        self.cat.save()
        desc = _get_event_description(self.event)
        self.assertIsNotNone(desc)

        # Test WARNING
        self.event.event_type = MatchEvent.EventType.WARNING
        self.event.payload = {"corner": "ao", "action_key": "c1", "is_undo": True}
        desc = _get_event_description(self.event)
        self.assertIsNotNone(desc)

        # Test SENSHU
        self.event.event_type = MatchEvent.EventType.SENSHU
        self.event.payload = {"corner": "aka", "value": True}
        desc = _get_event_description(self.event)
        self.assertIn("Сенсю", desc)

        # Test FLAGS_DECISION
        self.event.event_type = MatchEvent.EventType.FLAGS_DECISION
        self.event.payload = {"flags_aka": 3, "flags_ao": 2}
        desc = _get_event_description(self.event)
        self.assertIn("Рішення прапорами", desc)

        # Test START, FINISH, RESET
        self.event.event_type = MatchEvent.EventType.START
        desc = _get_event_description(self.event)
        self.assertIn("Початок поєдинку", desc)

        self.event.event_type = MatchEvent.EventType.FINISH
        self.event.payload = {"win_method": "ippon", "corner": "aka"}
        desc = _get_event_description(self.event)
        self.assertIn("Завершення поєдинку", desc)

        self.event.event_type = MatchEvent.EventType.RESET
        desc = _get_event_description(self.event)
        self.assertIn("Скидання стану поєдинку", desc)

        # Test TIMER_START, TIMER_PAUSE, TIMER_RESUME, TIMER_RESET
        self.event.event_type = MatchEvent.EventType.TIMER_START
        desc = _get_event_description(self.event)
        self.assertIn("Старт таймера", desc)

        self.event.event_type = MatchEvent.EventType.TIMER_PAUSE
        desc = _get_event_description(self.event)
        self.assertIn("Пауза таймера", desc)

        self.event.event_type = MatchEvent.EventType.TIMER_RESUME
        desc = _get_event_description(self.event)
        self.assertIn("Продовження таймера", desc)

        self.event.event_type = MatchEvent.EventType.TIMER_RESET
        desc = _get_event_description(self.event)
        self.assertIn("Скидання таймера", desc)

        # Test TIMER_SET_DUR
        self.event.event_type = MatchEvent.EventType.TIMER_SET_DUR
        self.event.payload = {"duration_ms": 60000}
        desc = _get_event_description(self.event)
        self.assertIn("Встановлено час таймера", desc)

        self.event.payload = {"delta_ms": 10000}
        desc = _get_event_description(self.event)
        self.assertIn("Зміна часу таймера", desc)

        # Test TIMER_TOGGLE, JUDGES_COUNT_CHANGE
        self.event.event_type = MatchEvent.EventType.TIMER_TOGGLE
        desc = _get_event_description(self.event)
        self.assertIn("Відображення таймера змінено", desc)

        self.event.event_type = MatchEvent.EventType.JUDGES_COUNT_CHANGE
        self.event.payload = {"judges_count": 3}
        desc = _get_event_description(self.event)
        self.assertIn("Зміна кількості суддів", desc)

        # Test RULESET_EVENT (taekwondo_wt / judo_ijf)
        self.event.event_type = MatchEvent.EventType.RULESET_EVENT

        self.cat.ruleset_key = "taekwondo_wt"
        self.cat.save()
        self.event.payload = {
            "ruleset_event_type": "ADD_POINTS",
            "payload": {"corner": "chung", "points": 3},
        }
        desc = _get_event_description(self.event)
        self.assertIn("Нарахування балів", desc)

        self.event.payload = {
            "ruleset_event_type": "SUB_POINTS",
            "payload": {"corner": "hong", "points": 1},
        }
        desc = _get_event_description(self.event)
        self.assertIn("Скасування балів", desc)

        self.event.payload = {
            "ruleset_event_type": "ADD_GAM_JEOM",
            "payload": {"corner": "chung", "is_passive": True, "remaining_seconds": 5},
        }
        desc = _get_event_description(self.event)
        self.assertIn("Gam-jeom", desc)

        self.event.payload = {"ruleset_event_type": "SUB_GAM_JEOM", "payload": {"corner": "hong"}}
        desc = _get_event_description(self.event)
        self.assertIn("Скасування Gam-jeom", desc)

        self.event.payload = {
            "ruleset_event_type": "NEXT_ROUND",
            "payload": {"round_winner": "chung"},
        }
        desc = _get_event_description(self.event)
        self.assertIn("Перехід до наступного раунду", desc)

        self.event.payload = {"ruleset_event_type": "RESET_ROUND"}
        desc = _get_event_description(self.event)
        self.assertIn("Скидання раунду", desc)

        self.event.payload = {"ruleset_event_type": "UNDO_ROUND"}
        desc = _get_event_description(self.event)
        self.assertIn("Назад (раунд)", desc)

        # Judo events
        self.cat.ruleset_key = "judo_ijf"
        self.cat.save()
        self.event.payload = {"ruleset_event_type": "ADD_WAZA_ARI", "payload": {"corner": "shiro"}}
        desc = _get_event_description(self.event)
        self.assertIn("Ваза-арі", desc)

        self.event.payload = {"ruleset_event_type": "SUB_WAZA_ARI", "payload": {"corner": "ao"}}
        desc = _get_event_description(self.event)
        self.assertIn("Скасування Ваза-арі", desc)

        self.event.payload = {"ruleset_event_type": "ADD_IPPON", "payload": {"corner": "shiro"}}
        desc = _get_event_description(self.event)
        self.assertIn("Іппон", desc)

        self.event.payload = {"ruleset_event_type": "SUB_IPPON", "payload": {"corner": "ao"}}
        desc = _get_event_description(self.event)
        self.assertIn("Скасування Іппон", desc)

        self.event.payload = {"ruleset_event_type": "ADD_SHIDO", "payload": {"corner": "shiro"}}
        desc = _get_event_description(self.event)
        self.assertIn("Шідо", desc)

        self.event.payload = {"ruleset_event_type": "SUB_SHIDO", "payload": {"corner": "ao"}}
        desc = _get_event_description(self.event)
        self.assertIn("Скасування Шідо", desc)

        self.event.payload = {
            "ruleset_event_type": "START_OSAEKOMI",
            "payload": {"corner": "shiro"},
        }
        desc = _get_event_description(self.event)
        self.assertIn("Початок утримання", desc)

        self.event.payload = {"ruleset_event_type": "STOP_OSAEKOMI"}
        desc = _get_event_description(self.event)
        self.assertIn("Зупинка утримання", desc)

    def test_match_event_inline_formatted(self):
        inline = MatchEventInline(Match, self.site)
        desc = inline.event_description(self.event)
        self.assertIsNotNone(desc)

        self.event.created_at = None
        self.assertEqual(inline.created_at_formatted(self.event), "-")
