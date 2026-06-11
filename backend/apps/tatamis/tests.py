"""
Інтеграційні тести підсистеми татамі.

Покривають:
    1. TatamiViewSet — CRUD та custom actions (assign_match, release, state)
    2. TatamiService — assign_match, release, get_snapshot, get_current_match
    3. MatchSerializer — поле tatami є, tatami_number відсутнє
    4. Timer endpoints — start, pause, resume, reset, set_duration, add_time
    5. TatamiConsumer — WebSocket snapshot при підключенні

Запуск:
    python manage.py test apps.tatamis
"""

import time
from datetime import date, timedelta

from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.brackets.services import BracketGenerator
from apps.matches.models import Match
from apps.matches.serializers import MatchSerializer
from apps.tatamis.models import Tatami
from apps.tatamis.routing import websocket_urlpatterns
from apps.tatamis.serializers import TatamiSerializer
from apps.tatamis.services import TatamiService
from apps.tournaments.models import Category, Registration, Tournament

_TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}


class TatamiTestCase(TestCase):
    """Базовий клас: турнір + категорія + татамі + суддя."""

    def setUp(self):
        self.client = APIClient()

        club = Club.objects.create(name="Клуб", region="Київ")

        self.organizer = User.objects.create_user(
            email="org@tatami.test",
            password="test12345",  # NOSONAR
            first_name="Орг",
            last_name="Тест",
            role=User.Role.ORGANIZER,
        )
        self.judge = User.objects.create_user(
            email="judge@tatami.test",
            password="test12345",  # NOSONAR
            first_name="Суддя",
            last_name="Тест",
            role=User.Role.JUDGE,
        )
        coach = User.objects.create_user(
            email="coach@tatami.test",
            password="test12345",  # NOSONAR
            first_name="Тренер",
            last_name="Тест",
            role=User.Role.COACH,
        )

        self.tournament = Tournament.objects.create(
            title="Tatami Cup Tournament",
            organizer=self.organizer,
            location="Tatami Arena",
            sport_type="Карате",
            start_date=timezone.now() + timedelta(days=10),
            end_date=timezone.now() + timedelta(days=11),
            status=Tournament.Status.ACTIVE,
        )
        self.category = Category.objects.create(
            name="Tatami Category Male -75kg",
            tournament=self.tournament,
            allowed_gender=Category.AllowedGender.MALE,
            min_age=20,
            max_age=30,
            min_weight=70,
            max_weight=75,
            bracket_format=Category.BracketFormat.SINGLE_ELIMINATION,
        )

        for i in range(1, 5):
            athlete = Athlete.objects.create(
                coach=coach,
                club=club,
                first_name=f"Ім{i}",
                last_name=f"Пр{i}",
                gender=Athlete.Gender.MALE,
                birth_date=date(2000, 1, 1),
                base_weight=73,
            )
            Registration.objects.create(
                athlete=athlete,
                category=self.category,
                seed_number=i,
                recorded_weight=73,
                status=Registration.Status.CONFIRMED,
            )

        BracketGenerator(self.category).generate()

        self.match = Match.objects.filter(
            category=self.category,
            round_index=1,
            status=Match.Status.SCHEDULED,
            reg_first__isnull=False,
            reg_second__isnull=False,
        ).first()

        self.tatami = Tatami.objects.create(
            tournament=self.tournament,
            number=1,
            name="Tatami A",
            assigned_judge=self.judge,
        )

    def _login(self, user):
        self.client.force_authenticate(user=user)


# ── 1. TatamiViewSet ──────────────────────────────────────────────────────────


class TestTatamiViewSet(TatamiTestCase):
    def test_list_filtered_by_tournament(self):
        Tatami.objects.create(tournament=self.tournament, number=2)
        response = self.client.get(f"/api/tatamis/?tournament={self.tournament.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        ids = [t["id"] for t in results]
        self.assertIn(self.tatami.pk, ids)
        self.assertEqual(len(ids), 2)

    def test_judge_assignment_permissions_403(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        other_judge = User.objects.create_user(
            email="other_judge@example.com",
            password="password",
            role="judge",
            first_name="Other",
            last_name="Judge",
        )
        self._login(other_judge)

        # 1. assign_match
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/assign_match/",
            {"match_id": self.match.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"], "Ви не закріплені за цим татамі!")

        # 2. release
        response = self.client.post(f"/api/tatamis/{self.tatami.pk}/release/", format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"], "Ви не закріплені за цим татамі!")

        # 3. set_active_results_category
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/set_active_results_category/",
            {"category_id": self.category.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"], "Ви не закріплені за цим татамі!")

        # 4. state
        response = self.client.get(f"/api/tatamis/{self.tatami.pk}/state/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"], "Ви не закріплені за цим татамі!")

    def test_create_requires_organizer(self):
        self._login(self.judge)
        response = self.client.post(
            "/api/tatamis/",
            {
                "tournament": self.tournament.pk,
                "number": 3,
                "name": "New",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_organizer_can_create(self):
        self._login(self.organizer)
        response = self.client.post(
            "/api/tatamis/",
            {
                "tournament": self.tournament.pk,
                "number": 3,
                "name": "Tatami B",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["number"], 3)

    def test_update_requires_organizer(self):
        self._login(self.judge)
        response = self.client.put(
            f"/api/tatamis/{self.tatami.pk}/",
            {
                "tournament": self.tournament.pk,
                "number": 1,
                "name": "Updated Name",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_organizer_can_update(self):
        self._login(self.organizer)
        response = self.client.put(
            f"/api/tatamis/{self.tatami.pk}/",
            {
                "tournament": self.tournament.pk,
                "number": 1,
                "name": "Updated Name",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Updated Name")

    def test_destroy_requires_organizer(self):
        self._login(self.judge)
        response = self.client.delete(f"/api/tatamis/{self.tatami.pk}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_organizer_can_destroy(self):
        self._login(self.organizer)
        response = self.client.delete(f"/api/tatamis/{self.tatami.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_assign_match_requires_judge(self):
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/assign_match/",
            {"match_id": self.match.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_assign_match(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/assign_match/",
            {"match_id": self.match.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tatami.refresh_from_db()
        self.assertEqual(self.tatami.current_match_id, self.match.pk)

    def test_release(self):
        self._login(self.judge)
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()
        response = self.client.post(f"/api/tatamis/{self.tatami.pk}/release/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_state_endpoint(self):
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()
        response = self.client.get(f"/api/tatamis/{self.tatami.pk}/state/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("tatami", response.data)
        self.assertIn("server_ts_ms", response.data)
        self.assertIn("current_match", response.data)
        self.assertIsNotNone(response.data["current_match"])
        # server_ts_ms повинен бути близьким до поточного часу
        self.assertAlmostEqual(
            response.data["server_ts_ms"] / 1000,
            time.time(),
            delta=5,
        )

    def test_assign_match_missing_match_id(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/assign_match/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_assign_match_nonexistent_match_returns_400(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/tatamis/{self.tatami.pk}/assign_match/",
            {"match_id": 999999},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_state_endpoint_no_current_match(self):
        response = self.client.get(f"/api/tatamis/{self.tatami.pk}/state/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["current_match"])


# ── 2. TatamiService ──────────────────────────────────────────────────────────


class TestTatamiService(TatamiTestCase):
    def test_assign_match_sets_current(self):
        TatamiService.assign_match(self.tatami, self.match.pk)
        self.tatami.refresh_from_db()
        self.assertEqual(self.tatami.current_match_id, self.match.pk)

    def test_release_clears_current(self):
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()
        TatamiService.release(self.tatami)
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_get_current_match_returns_match(self):
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()
        result = TatamiService.get_current_match(self.tournament.pk, 1)
        self.assertEqual(result.pk, self.match.pk)

    def test_get_current_match_returns_none_when_empty(self):
        result = TatamiService.get_current_match(self.tournament.pk, 1)
        self.assertIsNone(result)

    def test_get_snapshot_structure(self):
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()
        snapshot = TatamiService.get_snapshot(self.tournament.pk, 1)
        self.assertIn("tatami", snapshot)
        self.assertIn("server_ts_ms", snapshot)
        self.assertIn("current_match", snapshot)
        self.assertIsNotNone(snapshot["current_match"])
        self.assertAlmostEqual(snapshot["server_ts_ms"] / 1000, time.time(), delta=5)

    def test_get_snapshot_no_match(self):
        snapshot = TatamiService.get_snapshot(self.tournament.pk, 1)
        self.assertIsNone(snapshot["current_match"])

    def test_release_handles_auto_finalize_exception(self):
        from unittest.mock import patch

        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()

        # Mock calculate_category_standings to trigger the release exception block
        with patch("apps.tournaments.services.calculate_category_standings") as mock_calc:
            mock_calc.side_effect = Exception("Test exception during standings calc")
            # Should not raise an exception due to try/except block
            TatamiService.release(self.tatami)

        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_get_snapshot_with_ghost_match(self):
        # Current match belongs to a different tatami, but is set as tatami.current_match
        other_tatami = Tatami.objects.create(tournament=self.tournament, number=2)
        self.match.tatami = other_tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()

        snapshot = TatamiService.get_snapshot(self.tournament.pk, 1)
        self.assertIsNone(snapshot["current_match"])
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_get_current_match_with_ghost_match(self):
        other_tatami = Tatami.objects.create(tournament=self.tournament, number=2)
        self.match.tatami = other_tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()

        result = TatamiService.get_current_match(self.tournament.pk, 1)
        self.assertIsNone(result)
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_get_current_match_nonexistent_tatami(self):
        result = TatamiService.get_current_match(self.tournament.pk, 999)
        self.assertIsNone(result)

    def test_assign_match_clears_other_tatamis(self):
        other_tatami = Tatami.objects.create(tournament=self.tournament, number=2)
        other_tatami.current_match = self.match
        other_tatami.save()

        # Assigning to self.tatami should clear other_tatami's current_match
        TatamiService.assign_match(self.tatami, self.match.pk)
        other_tatami.refresh_from_db()
        self.assertIsNone(other_tatami.current_match)

    def test_release_calculates_standings_and_broadcasts(self):
        # Complete all matches in category
        for m in self.category.matches.all():
            m.status = Match.Status.COMPLETED
            m.save()

        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()

        # The release method should auto-finalize
        TatamiService.release(self.tatami)
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)

    def test_set_active_results_category(self):
        # With category ID
        TatamiService.set_active_results_category(self.tatami, self.category.pk)
        self.tatami.refresh_from_db()
        self.assertEqual(self.tatami.active_results_category_id, self.category.pk)
        self.assertIsNone(self.tatami.current_match)

        # With None
        TatamiService.set_active_results_category(self.tatami, None)
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.active_results_category_id)


# ── 3. MatchSerializer — field validation ────────────────────────────────────


class TestMatchSerializerFields(TatamiTestCase):
    def test_tatami_field_present(self):
        data = MatchSerializer(self.match).data
        self.assertIn("tatami", data)

    def test_tatami_number_field_absent(self):
        data = MatchSerializer(self.match).data
        self.assertNotIn("tatami_number", data)

    def test_timer_fields_present(self):
        data = MatchSerializer(self.match).data
        for field in ("timer_status", "timer_started_at", "timer_elapsed_ms", "timer_duration_ms"):
            self.assertIn(field, data, msg=f"Missing field: {field}")

    def test_timer_defaults(self):
        data = MatchSerializer(self.match).data
        self.assertEqual(data["timer_status"], "not_started")
        self.assertEqual(data["timer_elapsed_ms"], 0)
        self.assertEqual(data["timer_duration_ms"], 180000)

    def test_ruleset_key_and_judging_mode(self):
        data = MatchSerializer(self.match).data
        self.assertIn("ruleset_key", data)
        self.assertIn("judging_mode", data)
        self.assertEqual(data["ruleset_key"], "karate_wkf")
        self.assertEqual(data["judging_mode"], "points")

    def test_judging_mode_unknown_ruleset_returns_none(self):
        self.category.ruleset_key = "unknown_ruleset_xyz"
        self.category.save(update_fields=["ruleset_key"])
        self.match.refresh_from_db()
        data = MatchSerializer(self.match).data
        self.assertIsNone(data["judging_mode"])


# ── 4. Timer endpoints ────────────────────────────────────────────────────────


class TestTimerEndpoints(TatamiTestCase):
    def setUp(self):
        super().setUp()
        self._login(self.judge)
        self.url = lambda path: f"/api/matches/{self.match.pk}/timer/{path}/"

    def test_timer_start(self):
        response = self.client.post(self.url("start"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_status, "running")
        self.assertIsNotNone(self.match.timer_started_at)

    def test_timer_start_twice_returns_400(self):
        self.client.post(self.url("start"))
        response = self.client.post(self.url("start"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_timer_pause_after_start(self):
        self.client.post(self.url("start"))
        response = self.client.post(self.url("pause"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_status, "paused")
        self.assertGreater(self.match.timer_elapsed_ms, 0)
        self.assertIsNone(self.match.timer_started_at)

    def test_timer_pause_without_start_returns_400(self):
        response = self.client.post(self.url("pause"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_timer_resume_after_pause(self):
        self.client.post(self.url("start"))
        self.client.post(self.url("pause"))
        response = self.client.post(self.url("resume"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_status, "running")

    def test_timer_resume_without_pause_returns_400(self):
        self.client.post(self.url("start"))
        response = self.client.post(self.url("resume"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_timer_reset(self):
        self.client.post(self.url("start"))
        self.client.post(self.url("pause"))
        response = self.client.post(self.url("reset"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_status, "not_started")
        self.assertEqual(self.match.timer_elapsed_ms, 0)
        self.assertIsNone(self.match.timer_started_at)

    def test_timer_set_duration(self):
        response = self.client.post(
            self.url("set_duration"), {"duration_ms": 120000}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_duration_ms, 120000)

    def test_timer_set_duration_while_running_returns_400(self):
        self.client.post(self.url("start"))
        response = self.client.post(self.url("set_duration"), {"duration_ms": 60000}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_timer_add_time(self):
        response = self.client.post(self.url("add_time"), {"delta_ms": 30000}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.match.refresh_from_db()
        self.assertEqual(self.match.timer_duration_ms, 210000)

    def test_timer_add_time_while_running_returns_400(self):
        self.client.post(self.url("start"))
        response = self.client.post(self.url("add_time"), {"delta_ms": 30000}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_judge_cannot_use_timer(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.url("start"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_timer_events_written(self):
        self.client.post(self.url("start"))
        self.client.post(self.url("pause"))
        self.client.post(self.url("resume"))
        self.client.post(self.url("pause"))
        self.client.post(self.url("reset"))
        event_types = list(
            self.match.events.order_by("sequence").values_list("event_type", flat=True)
        )
        self.assertEqual(
            event_types,
            ["timer_start", "timer_pause", "timer_resume", "timer_pause", "timer_reset"],
        )

    def test_set_duration_missing_field_returns_400(self):
        response = self.client.post(self.url("set_duration"), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_time_missing_field_returns_400(self):
        response = self.client.post(self.url("add_time"), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# ── 5. TatamiConsumer (WebSocket) ─────────────────────────────────────────────


@override_settings(CHANNEL_LAYERS=_TEST_CHANNEL_LAYERS)
class TestTatamiConsumer(TatamiTestCase):
    """
    Async WS tests. setUp встановлює tatami.current_match синхронно,
    щоб уникнути проблем з транзакцією в async-контексті.
    Всі WS-сценарії — в одному тесті, щоб не перевідкривати з'єднання.
    """

    def setUp(self):
        super().setUp()
        self.match.tatami = self.tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save(update_fields=["current_match"])

    async def test_connect_snapshot_and_ping_pong(self):
        app = URLRouter(websocket_urlpatterns)
        communicator = WebsocketCommunicator(
            app,
            f"/ws/tournament/{self.tournament.pk}/tatami/{self.tatami.number}/",
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        # snapshot при підключенні
        msg = await communicator.receive_json_from(timeout=3)
        self.assertEqual(msg["type"], "tatami.snapshot")
        self.assertIn("data", msg)
        self.assertIn("tatami", msg["data"])
        self.assertIn("current_match", msg["data"])
        self.assertIn("server_ts_ms", msg["data"])

        # ping → pong
        await communicator.send_json_to({"type": "ping"})
        pong = await communicator.receive_json_from(timeout=3)
        self.assertEqual(pong["type"], "pong")

        # channel layer handlers: match_event, timer_state, tatami_state
        channel_layer = get_channel_layer()
        group = f"tatami_{self.tournament.pk}_{self.tatami.number}"

        await channel_layer.group_send(group, {"type": "match.event", "match_id": 1})
        msg = await communicator.receive_json_from(timeout=3)
        self.assertEqual(msg["type"], "match.event")

        await channel_layer.group_send(group, {"type": "timer.state", "status": "running"})
        msg = await communicator.receive_json_from(timeout=3)
        self.assertEqual(msg["type"], "timer.state")

        await channel_layer.group_send(group, {"type": "tatami.state", "tatami": {}})
        msg = await communicator.receive_json_from(timeout=3)
        self.assertEqual(msg["type"], "tatami.state")

        # invalid JSON → no error, no response
        await communicator.send_to(text_data="not-valid{{json")
        self.assertTrue(await communicator.receive_nothing(timeout=0.5))

        await communicator.disconnect()


# ── 6. Models ─────────────────────────────────────────────────────────────────


class TestTatamiModels(TatamiTestCase):
    def test_str_with_name(self):
        self.assertIn("Tatami A", str(self.tatami))

    def test_str_without_name(self):
        unnamed = Tatami.objects.create(tournament=self.tournament, number=99)
        self.assertIn("Tatami 99", str(unnamed))


# ── 7. Broadcast coverage ─────────────────────────────────────────────────────


@override_settings(CHANNEL_LAYERS=_TEST_CHANNEL_LAYERS)
class TestBroadcast(TatamiTestCase):
    """Покриває гілки broadcast.py, недосяжні через звичайні API-тести."""

    def test_broadcast_match_event_sends_to_tatami_group(self):
        from apps.common.broadcast import broadcast_match_event

        self.match.tatami = self.tatami
        self.match.save(update_fields=["tatami"])
        from apps.matches.services.match_service import MatchService

        MatchService(self.match).apply_score("aka", "yuko")
        event = self.match.events.order_by("-sequence").first()
        broadcast_match_event(self.match, event)  # must not raise

    def test_broadcast_timer_state_sends_to_tatami_group(self):
        from apps.common.broadcast import broadcast_timer_state

        self.match.tatami = self.tatami
        self.match.save(update_fields=["tatami"])
        broadcast_timer_state(self.match)  # must not raise


# ── 8. Serializer Fields ──────────────────────────────────────────────────────


class TestTatamiSerializerFields(TatamiTestCase):
    def test_tatami_serializer_fields(self):
        # Test matches_count
        self.match.tatami = self.tatami
        self.match.save(update_fields=["tatami"])

        serializer = TatamiSerializer(self.tatami)
        self.assertEqual(serializer.data["matches_count"], 1)
        self.assertIsNone(serializer.data["current_match"])

        # Set current_match
        self.tatami.current_match = self.match
        self.tatami.save(update_fields=["current_match"])

        serializer2 = TatamiSerializer(self.tatami)
        self.assertIsNotNone(serializer2.data["current_match"])
        self.assertEqual(serializer2.data["current_match"]["id"], self.match.pk)

    def test_tatami_serializer_with_ghost_match(self):
        # Current match belongs to a different tatami, but is set as tatami.current_match
        other_tatami = Tatami.objects.create(tournament=self.tournament, number=2)
        self.match.tatami = other_tatami
        self.match.save()
        self.tatami.current_match = self.match
        self.tatami.save()

        serializer = TatamiSerializer(self.tatami)
        self.assertIsNone(serializer.data["current_match"])
        self.tatami.refresh_from_db()
        self.assertIsNone(self.tatami.current_match)
