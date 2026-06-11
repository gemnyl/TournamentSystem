"""
Інтеграційні тести REST API поєдинків.

Покривають:
    1. Суддя може оновити рахунок матчу
    2. Суддя може зафіксувати переможця
    3. Переможець автоматично переноситься у next_match
    4. Несуддя не може оновити рахунок
    5. GET /api/matches/bracket/ — список раундів для візуалізації

Запуск:
    python manage.py test apps.matches
"""

from datetime import date, timedelta

from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.brackets.services import BracketGenerator
from apps.matches.models import Match
from apps.matches.routing import websocket_urlpatterns
from apps.matches.services.match_service import MatchService
from apps.tournaments.models import Category, Registration, Tournament

_TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}


class MatchAPITestCase(TestCase):
    """Базовий клас із повністю ініціалізованою сіткою (8 учасників)."""

    def setUp(self):
        self.client = APIClient()

        self.club_a = Club.objects.create(name="МА", region="Київ")
        self.club_b = Club.objects.create(name="МБ", region="Харків")

        self.organizer = User.objects.create_user(
            email="org@match.test",
            password="test12345",  # NOSONAR
            first_name="Орг",
            last_name="Тест",
            role=User.Role.ORGANIZER,
        )
        self.coach = User.objects.create_user(
            email="coach@match.test",
            password="test12345",  # NOSONAR
            first_name="Тренер",
            last_name="Тест",
            role=User.Role.COACH,
        )
        self.judge = User.objects.create_user(
            email="judge@match.test",
            password="test12345",  # NOSONAR
            first_name="Суддя",
            last_name="Тест",
            role=User.Role.JUDGE,
        )
        self.spectator = User.objects.create_user(
            email="spec@match.test",
            password="test12345",  # NOSONAR
            first_name="Глядач",
            last_name="Тест",
            role=User.Role.SPECTATOR,
        )

        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Матч Тест Кубок",
            sport_type="Карате",
            location="Арена",
            start_date=timezone.now() + timedelta(days=5),
            end_date=timezone.now() + timedelta(days=6),
            status=Tournament.Status.ACTIVE,
        )
        self.category = Category.objects.create(
            tournament=self.tournament,
            name="Чоловіки -75кг",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=35,
            min_weight=70,
            max_weight=75,
            bracket_format=Category.BracketFormat.SINGLE_ELIMINATION,
        )

        # Створюємо 8 підтверджених реєстрацій та генеруємо сітку
        self.registrations = []
        for i in range(1, 9):
            club = self.club_a if i % 2 else self.club_b
            athlete = Athlete.objects.create(
                coach=self.coach,
                club=club,
                first_name=f"Ім{i}",
                last_name=f"Пр{i}",
                gender=Athlete.Gender.MALE,
                birth_date=date(2000, 1, 1),
                base_weight=73,
            )
            reg = Registration.objects.create(
                athlete=athlete,
                category=self.category,
                seed_number=i,
                recorded_weight=73,
                status=Registration.Status.CONFIRMED,
            )
            self.registrations.append(reg)

        BracketGenerator(self.category).generate()

        # Перший матч першого раунду (обидва учасники — не BYE)
        self.first_round_match = Match.objects.filter(
            category=self.category,
            round_index=1,
            status=Match.Status.SCHEDULED,
            reg_first__isnull=False,
            reg_second__isnull=False,
        ).first()

    def _login(self, user):
        self.client.force_authenticate(user=user)


class TestMatchGetQueryset(MatchAPITestCase):
    """Покриває гілки get_queryset: фільтр по category і tournament."""

    def test_filter_by_tournament(self):
        response = self.client.get(f"/api/matches/?tournament={self.tournament.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertGreater(len(results), 0)
        for m in results:
            self.assertEqual(m["category"], self.category.pk)

    def test_filter_by_category(self):
        response = self.client.get(f"/api/matches/?category={self.category.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertGreater(len(results), 0)


class TestUpdateScore(MatchAPITestCase):
    """Тест 1: Суддя може оновити рахунок."""

    def test_judge_can_update_score(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"corner": "aka", "action_key": "yuko"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # yuko = 1 бал для aka (score_first)
        self.assertEqual(response.data["score_first"], 1)
        self.assertEqual(response.data["status"], Match.Status.ONGOING)

    def test_spectator_cannot_update_score(self):
        """Глядач не має права судити."""
        self._login(self.spectator)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"corner": "aka", "action_key": "yuko"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_corner_returns_400(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"corner": "invalid_corner", "action_key": "yuko"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_fields_returns_400(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestSetWinner(MatchAPITestCase):
    """Тест 2: Суддя фіксує переможця."""

    def test_judge_can_set_winner(self):
        self._login(self.judge)
        match = self.first_round_match
        winner_reg = match.reg_first

        response = self.client.post(
            f"/api/matches/{match.pk}/set_winner/",
            {"corner": "aka", "win_method": Match.WinMethod.HANTEI},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["winner"], winner_reg.pk)
        self.assertEqual(response.data["win_method"], Match.WinMethod.HANTEI)
        self.assertEqual(response.data["status"], Match.Status.COMPLETED)

    def test_invalid_corner_returns_400(self):
        """Неправильний corner → 400."""
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_winner/",
            {"corner": "invalid", "win_method": "hantei"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_corner_returns_400(self):
        """Відсутній corner → 400."""
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_winner/",
            {"win_method": "hantei"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestAdvanceParticipant(MatchAPITestCase):
    """Тест 3: Переможець переноситься у next_match."""

    def test_winner_advances_to_next_match(self):
        self._login(self.judge)
        match = self.first_round_match
        next_match = match.next_match
        winner_reg = match.reg_first

        # До встановлення переможця next_match має порожні слоти
        assert next_match.reg_first_id is None and next_match.reg_second_id is None

        self.client.post(
            f"/api/matches/{match.pk}/set_winner/",
            {"corner": "aka", "win_method": "hantei"},
            format="json",
        )

        next_match.refresh_from_db()
        # Один зі слотів тепер зайнятий переможцем
        self.assertTrue(
            next_match.reg_first == winner_reg or next_match.reg_second == winner_reg,
            "Переможець не з'явився у next_match після set_winner",
        )


class TestMatchService(MatchAPITestCase):
    """Юніт-тести MatchService — без HTTP, без channel layer."""

    def test_apply_score_creates_event(self):
        match = self.first_round_match
        MatchService(match).apply_score("aka", "yuko")
        self.assertEqual(match.events.count(), 1)
        event = match.events.first()
        self.assertEqual(event.event_type, "score")
        self.assertEqual(event.payload, {"corner": "aka", "action_key": "yuko"})
        self.assertIn("seq=1", str(event))
        self.assertIn("R1.", str(match))

    def test_apply_penalty_creates_warning_event(self):
        match = self.first_round_match
        MatchService(match).apply_score("ao", "penalty")
        event = match.events.first()
        self.assertEqual(event.event_type, "warning")
        match.refresh_from_db()
        self.assertEqual(match.warnings_second, 1)

    def test_apply_score_invalid_action_key_raises(self):
        match = self.first_round_match
        with self.assertRaises(ValueError):
            MatchService(match).apply_score("aka", "nonexistent")

    def test_apply_score_invalid_corner_raises(self):
        match = self.first_round_match
        with self.assertRaises(ValueError):
            MatchService(match).apply_score("shiro", "yuko")

    def test_auto_finish_on_8_point_diff(self):
        """3× ippon (9 балів) → auto-finish для WKF."""
        match = self.first_round_match
        svc = MatchService(match)
        for _ in range(3):
            svc.apply_score("aka", "ippon")
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertEqual(match.winner, match.reg_first)
        self.assertEqual(match.win_method, "points")

    def test_set_senshu_updates_match_and_writes_event(self):
        match = self.first_round_match
        MatchService(match).set_senshu("aka")
        match.refresh_from_db()
        self.assertEqual(match.senshu, "aka")
        event = match.events.first()
        self.assertEqual(event.event_type, "senshu")
        self.assertEqual(event.payload, {"value": "aka"})

    def test_set_senshu_reset_to_none(self):
        match = self.first_round_match
        svc = MatchService(match)
        svc.set_senshu("ao")
        svc.set_senshu("none")
        match.refresh_from_db()
        self.assertEqual(match.senshu, "none")

    def test_set_senshu_invalid_value_raises(self):
        match = self.first_round_match
        with self.assertRaises(ValueError):
            MatchService(match).set_senshu("shiro")

    def test_set_winner_none_participant_raises(self):
        match = self.first_round_match
        match.reg_second = None
        match.save(update_fields=["reg_second"])
        with self.assertRaises(ValueError):
            MatchService(match).set_winner("ao", "hantei")

    def test_sequence_increments_per_event(self):
        match = self.first_round_match
        svc = MatchService(match)
        svc.apply_score("aka", "yuko")
        svc.set_senshu("aka")
        sequences = list(match.events.values_list("sequence", flat=True).order_by("sequence"))
        self.assertEqual(sequences, [1, 2])

    def test_set_winner_invalid_registration_raises(self):
        from django.core.exceptions import ValidationError

        other_match = (
            Match.objects.filter(
                category=self.category,
                round_index=1,
                reg_first__isnull=False,
            )
            .exclude(id=self.first_round_match.id)
            .first()
        )
        invalid_reg = other_match.reg_first
        with self.assertRaises(ValidationError):
            self.first_round_match.set_winner(invalid_reg)

    def test_advance_participant_no_next_match_returns_silently(self):
        match = self.first_round_match
        match.winner = match.reg_first
        match.next_match = None
        match.advance_participant()  # повинно повернутись без помилки

    def test_advance_participant_fills_reg_second(self):
        match = self.first_round_match
        match.winner = match.reg_first
        nxt = match.next_match
        nxt.reg_first = match.reg_second
        nxt.save(update_fields=["reg_first"])
        match.advance_participant()
        nxt.refresh_from_db()
        self.assertEqual(nxt.reg_second, match.reg_first)

    def test_advance_participant_both_slots_full_raises(self):
        from django.core.exceptions import ValidationError

        match = self.first_round_match
        match.winner = match.reg_first
        nxt = match.next_match
        regs = list(
            Match.objects.filter(
                category=self.category, round_index=1, reg_first__isnull=False
            ).values_list("reg_first_id", flat=True)
        )
        from apps.tournaments.models import Registration

        r1, r2 = Registration.objects.filter(id__in=regs)[:2]
        nxt.reg_first = r1
        nxt.reg_second = r2
        nxt.save(update_fields=["reg_first", "reg_second"])
        with self.assertRaises(ValidationError):
            match.advance_participant()

    def test_apply_score_undo(self):
        match = self.first_round_match
        svc = MatchService(match)

        # 1. Warning undo
        svc.apply_score("aka", "penalty")
        match.refresh_from_db()
        self.assertEqual(match.warnings_first, 1)

        svc.apply_score("aka", "penalty", is_undo=True)
        match.refresh_from_db()
        self.assertEqual(match.warnings_first, 0)

        # 2. Score undo
        svc.apply_score("ao", "yuko")
        match.refresh_from_db()
        self.assertEqual(match.score_second, 1)

        svc.apply_score("ao", "yuko", is_undo=True)
        match.refresh_from_db()
        self.assertEqual(match.score_second, 0)

        # 3. WKF Senshu reset & rollback of next match slot on undo
        match.category.ruleset_key = "karate_wkf"
        match.category.save()
        match.refresh_from_db()

        svc.apply_score("aka", "yuko")
        match.refresh_from_db()
        self.assertEqual(match.senshu, "aka")
        self.assertEqual(match.score_first, 1)

        svc.set_winner("aka", Match.WinMethod.POINTS)
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertEqual(match.winner, match.reg_first)

        nxt = match.next_match
        nxt.refresh_from_db()
        self.assertEqual(nxt.reg_first, match.reg_first)

        svc.apply_score("aka", "yuko", is_undo=True)
        match.refresh_from_db()
        self.assertEqual(match.score_first, 0)
        self.assertEqual(match.senshu, "none")
        self.assertEqual(match.status, Match.Status.ONGOING)
        self.assertIsNone(match.winner)

        nxt.refresh_from_db()
        self.assertIsNone(nxt.reg_first)

        # Cover the `elif m.winner == nxt.reg_second` branch:
        match.score_first = 0
        match.score_second = 0
        match.senshu = "none"
        match.status = Match.Status.SCHEDULED
        match.winner = None
        match.save()

        nxt.reg_first = self.registrations[4]
        nxt.reg_second = None
        nxt.save()

        svc.apply_score("aka", "yuko")
        match.refresh_from_db()
        self.assertEqual(match.senshu, "aka")

        svc.set_winner("aka", Match.WinMethod.POINTS)
        match.refresh_from_db()
        nxt.refresh_from_db()
        self.assertEqual(nxt.reg_second, match.reg_first)

        svc.apply_score("aka", "yuko", is_undo=True)
        match.refresh_from_db()
        nxt.refresh_from_db()
        self.assertIsNone(nxt.reg_second)


class TestSetSenshuEndpoint(MatchAPITestCase):
    """Тест ендпоінту set_senshu через HTTP."""

    def test_judge_can_set_senshu(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_senshu/",
            {"value": "aka"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["senshu"], "aka")

    def test_reset_senshu_to_none(self):
        self._login(self.judge)
        match = self.first_round_match
        self.client.post(f"/api/matches/{match.pk}/set_senshu/", {"value": "ao"}, format="json")
        response = self.client.post(
            f"/api/matches/{match.pk}/set_senshu/", {"value": "none"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["senshu"], "none")

    def test_invalid_value_returns_400(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_senshu/",
            {"value": "shiro"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_value_returns_400(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(f"/api/matches/{match.pk}/set_senshu/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_spectator_cannot_set_senshu(self):
        self._login(self.spectator)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_senshu/",
            {"value": "aka"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class TestRulesetsEndpoint(MatchAPITestCase):
    """Тест GET /api/rulesets/."""

    def test_returns_all_rulesets(self):
        response = self.client.get("/api/rulesets/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        keys = {r["key"] for r in response.data}
        self.assertIn("karate_wkf", keys)
        self.assertIn("shobu_ippon", keys)

    def test_ruleset_has_required_fields(self):
        response = self.client.get("/api/rulesets/")
        first = response.data[0]
        for field in ("key", "name", "sport_type", "judging_mode"):
            self.assertIn(field, first)


class TestBracketEndpoint(MatchAPITestCase):
    """Тест 4: GET /api/matches/bracket/?category=<id>."""

    def test_bracket_returns_rounds(self):
        self._login(self.judge)
        response = self.client.get(f"/api/matches/bracket/?category={self.category.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # 8 учасників → 3 раунди (1/4, 1/2, фінал)
        self.assertEqual(len(response.data), 3)
        # Перший раунд — 4 матчі
        self.assertEqual(len(response.data[0]["matches"]), 4)

    def test_bracket_without_category_param_returns_400(self):
        self._login(self.judge)
        response = self.client.get("/api/matches/bracket/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


@override_settings(CHANNEL_LAYERS=_TEST_CHANNEL_LAYERS)
class TestMatchConsumer(SimpleTestCase):
    """Тести WebSocket consumer — підключення, ping/pong, match_event."""

    async def _communicator(self, category_id: int = 1) -> WebsocketCommunicator:
        return WebsocketCommunicator(
            URLRouter(websocket_urlpatterns),
            f"ws/category/{category_id}/",
        )

    async def test_connect_and_disconnect(self):
        comm = await self._communicator()
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        await comm.disconnect()

    async def test_ping_returns_pong(self):
        comm = await self._communicator()
        await comm.connect()
        await comm.send_json_to({"type": "ping"})
        response = await comm.receive_json_from()
        self.assertEqual(response["type"], "pong")
        await comm.disconnect()

    async def test_non_ping_message_no_response(self):
        comm = await self._communicator()
        await comm.connect()
        await comm.send_json_to({"type": "other"})
        self.assertTrue(await comm.receive_nothing())
        await comm.disconnect()

    async def test_invalid_json_no_error(self):
        comm = await self._communicator()
        await comm.connect()
        await comm.send_to(text_data="not-valid-json")
        self.assertTrue(await comm.receive_nothing())
        await comm.disconnect()

    async def test_match_event_forwarded_to_client(self):
        comm = await self._communicator(category_id=99)
        await comm.connect()

        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            "category_99",
            {
                "type": "match.event",
                "match_id": 7,
                "event": {
                    "sequence": 1,
                    "event_type": "score",
                    "payload": {"corner": "aka"},
                },
                "match": {"id": 7},
            },
        )

        response = await comm.receive_json_from()
        self.assertEqual(response["type"], "match.event")
        self.assertEqual(response["match_id"], 7)
        self.assertEqual(response["event"]["event_type"], "score")
        await comm.disconnect()


class TestKarateKataMatches(MatchAPITestCase):
    def setUp(self):
        super().setUp()
        # Змінимо рулсет нашої категорії на karate_kata
        self.category.ruleset_key = "karate_kata"
        self.category.save()
        # Оновимо рулсет-ключ першого матчу
        self.first_round_match.refresh_from_db()

    def test_set_judges_count(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 5},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.category.refresh_from_db()
        self.assertEqual(self.category.judges_count, 5)

        # Перевіримо, що у поєдинку також оновилося
        self.first_round_match.refresh_from_db()
        self.assertEqual(self.first_round_match.judges_count, 5)

    def test_set_judges_count_invalid(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 4},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_submit_flags_decision(self):
        self._login(self.judge)
        # Спочатку задамо кількість суддів
        self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 3},
            format="json",
        )

        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/submit_flags/", {"flags_aka": 2, "flags_ao": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertEqual(match.winner, match.reg_first)
        self.assertEqual(match.flags_aka, 2)
        self.assertEqual(match.flags_ao, 1)
        self.assertEqual(match.win_method, Match.WinMethod.DECISION)

    def test_submit_flags_invalid_sum(self):
        self._login(self.judge)
        self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 3},
            format="json",
        )

        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/submit_flags/",
            {"flags_aka": 2, "flags_ao": 2},  # Сума 4 замість 3
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_toggle_timer(self):
        self._login(self.judge)
        match = self.first_round_match
        self.assertFalse(match.show_timer)

        response = self.client.post(
            f"/api/matches/{match.pk}/toggle_timer/", {"show_timer": True}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertTrue(match.show_timer)

    def test_match_set_judges_count_success(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_judges_count/", {"judges_count": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertEqual(match.judges_count, 5)

    def test_match_set_judges_count_invalid(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_judges_count/", {"judges_count": 4}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_match_set_judges_count_resets_completed(self):
        self._login(self.judge)
        self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 3},
            format="json",
        )
        match = self.first_round_match
        # Зафіксуємо результат спочатку
        self.client.post(
            f"/api/matches/{match.pk}/submit_flags/", {"flags_aka": 2, "flags_ao": 1}, format="json"
        )
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertIsNotNone(match.winner)

        # Тепер змінимо кількість суддів для цього матчу
        response = self.client.post(
            f"/api/matches/{match.pk}/set_judges_count/", {"judges_count": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertEqual(match.judges_count, 5)
        self.assertEqual(match.status, Match.Status.SCHEDULED)
        self.assertIsNone(match.winner)
        self.assertIsNone(match.flags_aka)
        self.assertIsNone(match.flags_ao)

    def test_category_set_judges_count_resets_completed(self):
        self._login(self.judge)
        self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 3},
            format="json",
        )
        match = self.first_round_match
        # Зафіксуємо результат спочатку
        self.client.post(
            f"/api/matches/{match.pk}/submit_flags/", {"flags_aka": 2, "flags_ao": 1}, format="json"
        )
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertIsNotNone(match.winner)

        # Тепер змінимо кількість суддів для ВСІЄЇ категорії
        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 5},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertEqual(match.judges_count, 5)
        self.assertEqual(match.status, Match.Status.SCHEDULED)
        self.assertIsNone(match.winner)
        self.assertIsNone(match.flags_aka)
        self.assertIsNone(match.flags_ao)
