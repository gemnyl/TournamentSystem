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

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.brackets.services import BracketGenerator
from apps.matches.models import Match
from apps.tournaments.models import Category, Registration, Tournament


class MatchAPITestCase(TestCase):
    """Базовий клас із повністю ініціалізованою сіткою (8 учасників)."""

    def setUp(self):
        self.client = APIClient()

        self.club_a = Club.objects.create(name="МА", region="Київ")
        self.club_b = Club.objects.create(name="МБ", region="Харків")

        self.organizer = User.objects.create_user(
            email="org@match.test",
            password="test12345",
            first_name="Орг",
            last_name="Тест",
            role=User.Role.ORGANIZER,
        )
        self.coach = User.objects.create_user(
            email="coach@match.test",
            password="test12345",
            first_name="Тренер",
            last_name="Тест",
            role=User.Role.COACH,
        )
        self.judge = User.objects.create_user(
            email="judge@match.test",
            password="test12345",
            first_name="Суддя",
            last_name="Тест",
            role=User.Role.JUDGE,
        )
        self.spectator = User.objects.create_user(
            email="spec@match.test",
            password="test12345",
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


class TestUpdateScore(MatchAPITestCase):
    """Тест 1: Суддя може оновити рахунок."""

    def test_judge_can_update_score(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"participant": 1, "delta": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["score_first"], 1)
        # Статус має перейти в ONGOING
        self.assertEqual(response.data["status"], Match.Status.ONGOING)

    def test_spectator_cannot_update_score(self):
        """Глядач не має права судити."""
        self._login(self.spectator)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"participant": 1, "delta": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_participant_returns_400(self):
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/update_score/",
            {"participant": 99, "delta": 1},
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
            {"winner_id": winner_reg.pk, "method": Match.WinMethod.POINTS},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["winner"], winner_reg.pk)
        self.assertEqual(response.data["win_method"], Match.WinMethod.POINTS)
        self.assertEqual(response.data["status"], Match.Status.COMPLETED)

    def test_invalid_winner_id_returns_400(self):
        """winner_id не з учасників матчу → 400."""
        self._login(self.judge)
        match = self.first_round_match
        response = self.client.post(
            f"/api/matches/{match.pk}/set_winner/",
            {"winner_id": 99999, "method": "decision"},
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
            {"winner_id": winner_reg.pk, "method": "decision"},
            format="json",
        )

        next_match.refresh_from_db()
        # Один зі слотів тепер зайнятий переможцем
        self.assertTrue(
            next_match.reg_first == winner_reg or next_match.reg_second == winner_reg,
            "Переможець не з'явився у next_match після set_winner",
        )


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
