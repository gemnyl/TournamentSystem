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
        for idx in range(1, 9):
            ath = Athlete.objects.create(
                coach=self.coach,
                club=self.club_a if idx % 2 else self.club_b,
                first_name=f"TestF_{idx}",
                last_name=f"TestL_{idx}",
                gender=Athlete.Gender.MALE,
                birth_date=date(2000, 1, 1),
                base_weight=73.0,
            )
            self.registrations.append(
                Registration.objects.create(
                    athlete=ath,
                    category=self.category,
                    seed_number=idx,
                    recorded_weight=73.0,
                    status=Registration.Status.CONFIRMED,
                    payment_status="paid",
                )
            )

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

    def test_apply_score_undo_ao_warning(self):
        match = self.first_round_match
        svc = MatchService(match)

        # Test warning undo for ao
        svc.apply_score("ao", "penalty")
        match.refresh_from_db()
        self.assertEqual(match.warnings_second, 1)

        svc.apply_score("ao", "penalty", is_undo=True)
        match.refresh_from_db()
        self.assertEqual(match.warnings_second, 0)

    def test_set_draw(self):
        from django.core.exceptions import ValidationError

        match = self.first_round_match
        svc = MatchService(match)

        # Draw is not allowed for single elimination by default
        self.assertEqual(match.category.bracket_format, "single_elimination")
        with self.assertRaises(ValidationError):
            svc.set_draw()

        # Set to round robin
        match.category.bracket_format = "round_robin"
        match.category.save()
        match.refresh_from_db()

        svc.set_draw()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertIsNone(match.winner)
        self.assertEqual(match.win_method, "draw")

    def test_adjust_timer_duration(self):
        match = self.first_round_match
        svc = MatchService(match)

        # Normal adjustment
        svc.timer_add_time(10000)
        match.refresh_from_db()
        self.assertEqual(match.timer_duration_ms, 190000)

        # Negative duration error
        with self.assertRaises(ValueError):
            svc.timer_add_time(-300000)

        # Duration adjustment while running raises ValueError
        match.timer_status = Match.TimerStatus.RUNNING
        match.save()
        with self.assertRaises(ValueError):
            svc.timer_add_time(10000)

    def test_timer_start_and_pause(self):
        match = self.first_round_match
        svc = MatchService(match)

        # Start timer
        svc.timer_start()
        match.refresh_from_db()
        self.assertEqual(match.timer_status, Match.TimerStatus.RUNNING)
        self.assertIsNotNone(match.timer_started_at)

        # Pause timer within 5 seconds delta
        svc.timer_pause(elapsed_ms=1000)
        match.refresh_from_db()
        self.assertEqual(match.timer_status, Match.TimerStatus.PAUSED)
        self.assertEqual(match.timer_elapsed_ms, 1000)

        # Start again
        svc.timer_resume()

        # Pause timer outside 5 seconds delta
        svc.timer_pause(elapsed_ms=20000)
        match.refresh_from_db()
        self.assertEqual(match.timer_status, Match.TimerStatus.PAUSED)
        self.assertLess(match.timer_elapsed_ms, 5000)

    def test_reset_match(self):
        from django.core.exceptions import ValidationError

        match = self.first_round_match
        svc = MatchService(match)

        # Advance participant
        svc.apply_score("aka", "yuko")
        svc.set_winner("aka", Match.WinMethod.POINTS)
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)

        nxt = match.next_match
        nxt.refresh_from_db()
        self.assertEqual(nxt.reg_first, match.reg_first)

        # Try to reset when next match is already ongoing (not scheduled) -> raises ValidationError
        nxt.status = Match.Status.ONGOING
        nxt.save()
        with self.assertRaises(ValidationError):
            svc.reset_match()

        # Reset works when next match is scheduled
        nxt.status = Match.Status.SCHEDULED
        nxt.save()

        svc.reset_match()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.SCHEDULED)
        self.assertEqual(match.score_first, 0)

        nxt.refresh_from_db()
        self.assertIsNone(nxt.reg_first)


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


class TestMatchTimerEndpoints(MatchAPITestCase):
    def test_timer_lifecycle_via_api(self):
        self._login(self.judge)
        match = self.first_round_match

        # Start
        response = self.client.post(f"/api/matches/{match.pk}/timer/start/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timer_status"], "running")

        # Pause
        response = self.client.post(
            f"/api/matches/{match.pk}/timer/pause/", {"elapsed_ms": 5000}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timer_status"], "paused")

        # Resume
        response = self.client.post(f"/api/matches/{match.pk}/timer/resume/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timer_status"], "running")

        # Reset
        self.client.post(
            f"/api/matches/{match.pk}/timer/pause/", {"elapsed_ms": 6000}, format="json"
        )
        response = self.client.post(f"/api/matches/{match.pk}/timer/reset/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Set duration
        response = self.client.post(
            f"/api/matches/{match.pk}/timer/set_duration/", {"duration_ms": 120000}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timer_duration_ms"], 120000)

        # Set duration missing duration_ms
        response = self.client.post(
            f"/api/matches/{match.pk}/timer/set_duration/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Add time
        response = self.client.post(
            f"/api/matches/{match.pk}/timer/add_time/", {"delta_ms": 10000}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Add time missing delta_ms
        response = self.client.post(f"/api/matches/{match.pk}/timer/add_time/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Toggle timer
        response = self.client.post(
            f"/api/matches/{match.pk}/toggle_timer/", {"show_timer": False}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Toggle timer missing show_timer
        response = self.client.post(f"/api/matches/{match.pk}/toggle_timer/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Set draw API (fails because single elimination)
        response = self.client.post(f"/api/matches/{match.pk}/set_draw/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Reset match API
        response = self.client.post(f"/api/matches/{match.pk}/reset_match/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


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

    def _setup_completed_match_with_judges(self):
        self._login(self.judge)
        self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 3},
            format="json",
        )
        match = self.first_round_match
        self.client.post(
            f"/api/matches/{match.pk}/submit_flags/", {"flags_aka": 2, "flags_ao": 1}, format="json"
        )
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.COMPLETED)
        self.assertIsNotNone(match.winner)
        return match

    def _assert_match_reset_to_judges_count(self, match, count):
        match.refresh_from_db()
        self.assertEqual(match.judges_count, count)
        self.assertEqual(match.status, Match.Status.SCHEDULED)
        self.assertIsNone(match.winner)
        self.assertIsNone(match.flags_aka)
        self.assertIsNone(match.flags_ao)

    def test_match_set_judges_count_resets_completed(self):
        match = self._setup_completed_match_with_judges()
        # Тепер змінимо кількість суддів для цього матчу
        response = self.client.post(
            f"/api/matches/{match.pk}/set_judges_count/", {"judges_count": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self._assert_match_reset_to_judges_count(match, 5)

    def test_category_set_judges_count_resets_completed(self):
        match = self._setup_completed_match_with_judges()
        # Тепер змінимо кількість суддів для ВСІЄЇ категорії
        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/",
            {"judges_count": 5},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self._assert_match_reset_to_judges_count(match, 5)


class TestMatchesExtraActions(MatchAPITestCase):
    def test_filter_by_tatami_number(self):
        from apps.tatamis.models import Tatami

        tatami = Tatami.objects.create(tournament=self.tournament, number=1)
        self.first_round_match.tatami = tatami
        self.first_round_match.save()

        response = self.client.get("/api/matches/?tatami_number=1")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], self.first_round_match.pk)

    def test_set_draw_validation_and_errors(self):
        self._login(self.judge)
        # Try to set draw on a single elimination match where draw is not allowed
        response = self.client.post(f"/api/matches/{self.first_round_match.pk}/set_draw/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_set_draw_success(self):
        self._login(self.judge)
        # Draw is allowed in round robin brackets
        self.category.bracket_format = "round_robin"
        self.category.save()

        response = self.client.post(
            f"/api/matches/{self.first_round_match.pk}/set_draw/",
            {"win_method": "draw"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.first_round_match.refresh_from_db()
        self.assertEqual(self.first_round_match.win_method, Match.WinMethod.DRAW)

    def test_reset_match_errors(self):
        self._login(self.judge)
        # Call reset match
        response = self.client.post(f"/api/matches/{self.first_round_match.pk}/reset_match/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Trigger a ValidationError by modifying next match status to ongoing and setting a winner
        self.first_round_match.reg_first = self.category.registrations.all()[0]
        self.first_round_match.reg_second = self.category.registrations.all()[1]
        self.first_round_match.save()
        self.first_round_match.next_match.status = Match.Status.ONGOING
        self.first_round_match.next_match.save()

        response = self.client.post(f"/api/matches/{self.first_round_match.pk}/reset_match/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_submit_flags_validation(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/matches/{self.first_round_match.pk}/submit_flags/",
            {"flags_aka": 1},  # missing flags_ao
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_toggle_timer_validation(self):
        self._login(self.judge)
        # Missing show_timer
        response = self.client.post(
            f"/api/matches/{self.first_round_match.pk}/toggle_timer/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            f"/api/matches/{self.first_round_match.pk}/toggle_timer/",
            {"show_timer": "invalid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_toggle_timer_completed_match_error(self):
        self._login(self.judge)
        from unittest.mock import patch

        with patch("apps.matches.views.MatchService.toggle_timer") as mock_toggle:
            mock_toggle.side_effect = ValueError("Mock error")
            response = self.client.post(
                f"/api/matches/{self.first_round_match.pk}/toggle_timer/",
                {"show_timer": True},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_set_judges_count_validation(self):
        self._login(self.judge)
        response = self.client.post(
            f"/api/matches/{self.first_round_match.pk}/set_judges_count/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_team_match_reset_and_score_recalculation(self):
        # Create a team category
        team_cat = Category.objects.create(
            tournament=self.tournament,
            name="Командне куміте",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=35,
            bracket_format=Category.BracketFormat.SINGLE_ELIMINATION,
            is_team=True,
            team_size=3,
        )

        from apps.athletes.models import Team

        team1 = Team.objects.create(name="Команда 1", club=self.club_a, coach=self.coach)
        team2 = Team.objects.create(name="Команда 2", club=self.club_b, coach=self.coach)

        reg_team1 = Registration.objects.create(
            category=team_cat, team=team1, status=Registration.Status.CONFIRMED
        )
        reg_team2 = Registration.objects.create(
            category=team_cat, team=team2, status=Registration.Status.CONFIRMED
        )

        # Create athletes for teams
        ath1 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="A1",
            last_name="L1",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=73.0,
        )
        ath2 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_b,
            first_name="A2",
            last_name="L2",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=73.0,
        )
        team1.athletes.add(ath1)
        team2.athletes.add(ath2)

        # Parent team match
        parent_match = Match.objects.create(
            category=team_cat,
            round_index=1,
            match_order=1,
            reg_first=reg_team1,
            reg_second=reg_team2,
            status=Match.Status.SCHEDULED,
        )

        # Generating sub-bouts triggers on save in models.py because
        # parent_team_match is None and reg_first/second exist
        bouts = list(parent_match.team_bouts.all())
        self.assertEqual(len(bouts), 3)

        # Simulate finishing first 2 bouts in favor of AKA (team1)
        bout1 = bouts[0]
        bout2 = bouts[1]

        # Complete bout1
        bout1_svc = MatchService(bout1)
        bout1_svc.set_winner("aka", Match.WinMethod.POINTS)
        bout1.refresh_from_db()
        self.assertEqual(bout1.status, Match.Status.COMPLETED)
        self.assertEqual(bout1.winner, reg_team1)

        parent_match.refresh_from_db()
        # Parent match should have score 1 : 0 and status ongoing
        self.assertEqual(parent_match.score_first, 1)
        self.assertEqual(parent_match.score_second, 0)
        self.assertEqual(parent_match.status, Match.Status.ONGOING)

        # Complete bout2
        bout2_svc = MatchService(bout2)
        bout2_svc.set_winner("aka", Match.WinMethod.POINTS)
        bout2.refresh_from_db()
        self.assertEqual(bout2.status, Match.Status.COMPLETED)
        self.assertEqual(bout2.winner, reg_team1)

        # Since AKA has 2 wins out of 3, the parent match should be automatically completed
        parent_match.refresh_from_db()
        self.assertEqual(parent_match.score_first, 2)
        self.assertEqual(parent_match.score_second, 0)
        self.assertEqual(parent_match.status, Match.Status.COMPLETED)
        self.assertEqual(parent_match.winner, reg_team1)

        # Reset bout1
        bout1_svc.reset_match()
        bout1.refresh_from_db()
        self.assertEqual(bout1.status, Match.Status.SCHEDULED)
        self.assertIsNone(bout1.winner)

        # Now, parent match should have score 1 : 0, winner None, status ongoing
        parent_match.refresh_from_db()
        self.assertEqual(parent_match.score_first, 1)
        self.assertEqual(parent_match.score_second, 0)
        self.assertIsNone(parent_match.winner)
        self.assertEqual(parent_match.status, Match.Status.ONGOING)

        # Resetting the parent match directly
        parent_svc = MatchService(parent_match)
        parent_svc.reset_match()

        parent_match.refresh_from_db()
        self.assertEqual(parent_match.status, Match.Status.SCHEDULED)
        self.assertEqual(parent_match.score_first, 0)
        self.assertEqual(parent_match.score_second, 0)
        self.assertIsNone(parent_match.winner)

        # All child bouts must also be reset to scheduled
        for b in parent_match.team_bouts.all():
            self.assertEqual(b.status, Match.Status.SCHEDULED)
            self.assertEqual(b.score_first, 0)
            self.assertEqual(b.score_second, 0)
            self.assertIsNone(b.winner)

    def test_matches_viewset_extra_endpoints(self):
        """Тест додаткових ендпоінтів MatchViewSet.

        (events, assign_bout_athletes, spawn_extra_bout)
        """
        self._login(self.judge)

        # 1. GET events
        # Створюємо подію для матчу
        from apps.matches.models import MatchEvent

        MatchEvent.objects.create(
            match=self.first_round_match,
            event_type="score",
            sequence=1,
            payload={"competitor": "aka", "point_type": "ippon", "match_time_ms": 5000},
        )
        response = self.client.get(f"/api/matches/{self.first_round_match.pk}/events/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["event_type"], "score")

        # 2. POST spawn_extra_bout
        # Створимо спочатку командний матч
        team_cat = Category.objects.create(
            tournament=self.tournament,
            name="Командне куміте Тест",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=35,
            bracket_format=Category.BracketFormat.SINGLE_ELIMINATION,
            is_team=True,
            team_size=3,
        )
        parent_match = Match.objects.create(
            category=team_cat,
            round_index=1,
            match_order=1,
            status=Match.Status.SCHEDULED,
        )
        response = self.client.post(f"/api/matches/{parent_match.pk}/spawn_extra_bout/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Очікуємо 1 бій (оскільки дефолтні бої не створюються без реєстрацій)
        parent_match.refresh_from_db()
        self.assertEqual(parent_match.team_bouts.count(), 1)

        # Спроба викликати spawn_extra_bout для не-командного матчу -> 400
        response = self.client.post(f"/api/matches/{self.first_round_match.pk}/spawn_extra_bout/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. POST assign_bout_athletes
        # Візьмемо один з боїв командного матчу
        bout = parent_match.team_bouts.first()
        from apps.athletes.models import Athlete

        ath1 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Aka_Athlete",
            last_name="Aka_L",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=70.0,
        )
        ath2 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_b,
            first_name="Ao_Athlete",
            last_name="Ao_L",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=70.0,
        )
        payload = {"athlete_first_id": ath1.id, "athlete_second_id": ath2.id}
        url = f"/api/matches/{bout.pk}/assign_bout_athletes/"
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bout.refresh_from_db()
        self.assertEqual(bout.athlete_first, ath1)
        self.assertEqual(bout.athlete_second, ath2)

        # Скидання призначень спортсменів (None values)
        payload_none = {"athlete_first_id": None, "athlete_second_id": None}
        response = self.client.post(url, payload_none, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bout.refresh_from_db()
        self.assertIsNone(bout.athlete_first)
        self.assertIsNone(bout.athlete_second)

        # Спроба викликати для індивідуального бою не-командного матчу -> 400
        url_non_team = f"/api/matches/{self.first_round_match.pk}/assign_bout_athletes/"
        response = self.client.post(url_non_team, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Неіснуючі атлети -> 400
        payload_invalid = {"athlete_first_id": 999999, "athlete_second_id": 888888}
        response = self.client.post(url, payload_invalid, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestMatchSequencingAndRollback(MatchAPITestCase):
    """Тести для перевірки черговості вибору наступного матчу та логіки відкоту (rollback)."""

    def setUp(self):
        super().setUp()
        from apps.tatamis.models import Tatami

        self.tatami = Tatami.objects.create(tournament=self.tournament, number=2)

    def test_auto_advance_respects_round_order(self):
        """Перевіряє, що ручний/явний перехід вибирає поєдинок з молодшого раунду.

        Молодший раунд повинен гратися першим, навіть якщо поєдинок
        зі старшого раунду вже повністю укомплектований.
        """
        # Очищуємо всі раніше створені матчі
        Match.objects.filter(category=self.category).delete()

        # Створюємо чисті матчі
        # m1 (поточний поєдинок на татамі, завершується)
        m1 = Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=1,
            reg_first=self.category.registrations.all()[0],
            reg_second=self.category.registrations.all()[1],
            status=Match.Status.ONGOING,
            tatami=self.tatami,
        )
        self.tatami.current_match = m1
        self.tatami.save()

        # R1.2 (готовий поєдинок з молодшого раунду)
        m_r1_2 = Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=2,
            reg_first=self.category.registrations.all()[2],
            reg_second=self.category.registrations.all()[3],
            status=Match.Status.SCHEDULED,
            tatami=self.tatami,
        )

        # R2.1 (готовий поєдинок зі старшого раунду)
        Match.objects.create(
            category=self.category,
            round_index=2,
            match_order=1,
            reg_first=self.category.registrations.all()[4],
            reg_second=self.category.registrations.all()[5],
            status=Match.Status.SCHEDULED,
            tatami=self.tatami,
        )

        # Завершуємо m1 через сервіс (це не повинно автоматично перемикати татамі)
        svc = MatchService(m1)
        svc.set_winner("aka", Match.WinMethod.POINTS)

        self.tatami.refresh_from_db()
        self.assertEqual(self.tatami.current_match_id, m1.id)

        # Викликаємо перехід до наступного поєдинку в черзі татамі явним чином
        m1._handle_tatami_auto_advance()

        self.tatami.refresh_from_db()
        # Очікуємо, що татамі перейде на m_r1_2 (молодший раунд 1), а не на m_r2_1 (раунд 2)
        self.assertEqual(self.tatami.current_match_id, m_r1_2.id)

    def test_reset_match_syncs_tatami_and_clears_loser_next_match(self):
        """Перевіряє, що відкіт матчу очищає loser_next_match та повертає Tatami.current_match."""
        # Очищуємо всі раніше створені матчі
        Match.objects.filter(category=self.category).delete()

        # Створюємо фейкові наступні матчі
        nxt_win = Match.objects.create(
            category=self.category,
            round_index=2,
            match_order=1,
            status=Match.Status.SCHEDULED,
        )
        nxt_los = Match.objects.create(
            category=self.category,
            round_index=2,
            match_order=2,
            status=Match.Status.SCHEDULED,
        )

        # Створюємо чистий матч m
        m = Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=1,
            reg_first=self.category.registrations.all()[0],
            reg_second=self.category.registrations.all()[1],
            status=Match.Status.ONGOING,
            tatami=self.tatami,
            next_match=nxt_win,
            loser_next_match=nxt_los,
        )

        # Створюємо додаткові незіграні матчі першого раунду з обома учасниками,
        # щоб запобігти автоматичній технічній перемозі (WALKOVER) у наступних матчах
        Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=2,
            reg_first=self.category.registrations.all()[2],
            reg_second=self.category.registrations.all()[3],
            status=Match.Status.SCHEDULED,
            next_match=nxt_win,
        )
        Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=3,
            reg_first=self.category.registrations.all()[4],
            reg_second=self.category.registrations.all()[5],
            status=Match.Status.SCHEDULED,
            loser_next_match=nxt_los,
        )

        # Ставимо m як поточний на татамі
        self.tatami.current_match = m
        self.tatami.save()

        # Завершуємо m
        svc = MatchService(m)
        svc.set_winner("aka", Match.WinMethod.POINTS)

        # Переможець має бути в nxt_win, а той, хто програв — в nxt_los
        nxt_win.refresh_from_db()
        nxt_los.refresh_from_db()
        self.assertIsNotNone(nxt_win.reg_first or nxt_win.reg_second)
        self.assertIsNotNone(nxt_los.reg_first or nxt_los.reg_second)

        # Імітуємо, що татамі перейшло на nxt_win помилково
        self.tatami.current_match = nxt_win
        self.tatami.save()

        # Робимо відкіт матчу m
        self._login(self.judge)
        response = self.client.post(f"/api/matches/{m.pk}/reset_match/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content.decode("utf-8"))

        # Перевіряємо, що учасників очищено з наступних поєдинків та їх статус SCHEDULED
        nxt_win.refresh_from_db()
        nxt_los.refresh_from_db()
        self.assertIsNone(nxt_win.reg_first)
        self.assertIsNone(nxt_win.reg_second)
        self.assertIsNone(nxt_los.reg_first)
        self.assertIsNone(nxt_los.reg_second)
        self.assertEqual(nxt_win.status, Match.Status.SCHEDULED)
        self.assertEqual(nxt_los.status, Match.Status.SCHEDULED)

        # Перевіряємо, що татамі знову показує відкочений матч m
        self.tatami.refresh_from_db()
        self.assertEqual(self.tatami.current_match_id, m.id)
