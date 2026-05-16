"""
Інтеграційні тести REST API турнірної підсистеми.

Покривають:
    1. Створення турніру організатором
    2. Реєстрацію спортсмена тренером
    3. Генерацію сітки через API endpoint
    4. Перевірку прав доступу (не-організатор не може створити турнір)
    5. Підтвердження зважування організатором

Запуск:
    python manage.py test apps.tournaments
"""

from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.tournaments.models import Category, Registration, Tournament


class TournamentAPITestCase(TestCase):
    """Базовий клас із спільним setUp для всіх тестів турнірів."""

    def setUp(self):
        self.client = APIClient()

        # Клуби
        self.club_a = Club.objects.create(name="Тест Клуб А", region="Київ")
        self.club_b = Club.objects.create(name="Тест Клуб Б", region="Львів")

        # Користувачі
        self.organizer = User.objects.create_user(
            email="organizer@test.local",
            password="test12345",
            first_name="Органіс",
            last_name="Таторенко",
            role=User.Role.ORGANIZER,
            club=self.club_a,
        )
        self.coach = User.objects.create_user(
            email="coach@test.local",
            password="test12345",
            first_name="Тренер",
            last_name="Коченко",
            role=User.Role.COACH,
            club=self.club_a,
        )
        self.judge = User.objects.create_user(
            email="judge@test.local",
            password="test12345",
            first_name="Суддя",
            last_name="Суддяренко",
            role=User.Role.JUDGE,
        )

        # Базовий турнір
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Тестовий Турнір",
            sport_type="Карате",
            location="Тест Арена",
            start_date=timezone.now() + timedelta(days=30),
            end_date=timezone.now() + timedelta(days=31),
            status=Tournament.Status.REGISTRATION,
        )

        # Базова категорія
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

    def _login(self, user):
        """Авторизує клієнта від імені вказаного користувача."""
        self.client.force_authenticate(user=user)

    def _create_athlete(self, idx, club=None):
        """Хелпер: створює атлета з підтвердженою реєстрацією."""
        club = club or self.club_a
        athlete = Athlete.objects.create(
            coach=self.coach,
            club=club,
            first_name=f"Ім'я{idx}",
            last_name=f"Прізвище{idx}",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=73,
        )
        reg = Registration.objects.create(
            athlete=athlete,
            category=self.category,
            seed_number=idx,
            recorded_weight=73,
            status=Registration.Status.CONFIRMED,
        )
        return athlete, reg


class TestTournamentCreation(TournamentAPITestCase):
    """Тест 1: Організатор може створити турнір."""

    def test_organizer_can_create_tournament(self):
        self._login(self.organizer)
        payload = {
            "title": "Новий Кубок",
            "sport_type": "Дзюдо",
            "location": "Спорткомплекс",
            "start_date": (timezone.now() + timedelta(days=60)).isoformat(),
            "end_date": (timezone.now() + timedelta(days=61)).isoformat(),
        }
        response = self.client.post("/api/tournaments/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["title"], "Новий Кубок")
        self.assertEqual(response.data["status"], Tournament.Status.DRAFT)

    def test_coach_cannot_create_tournament(self):
        """Тренер не має права створювати турніри."""
        self._login(self.coach)
        payload = {
            "title": "Спроба тренера",
            "sport_type": "Карате",
            "location": "Десь",
            "start_date": (timezone.now() + timedelta(days=10)).isoformat(),
            "end_date": (timezone.now() + timedelta(days=11)).isoformat(),
        }
        response = self.client.post("/api/tournaments/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_tournament_status_transitions(self):
        """Перевірка переходів статусів: draft → registration → active → completed."""
        self._login(self.organizer)
        # Починаємо з чернетки
        t = Tournament.objects.create(
            organizer=self.organizer,
            title="Стейт Турнір",
            sport_type="Тхеквондо",
            location="Зал",
            start_date=timezone.now() + timedelta(days=10),
            end_date=timezone.now() + timedelta(days=11),
        )
        self.assertEqual(t.status, Tournament.Status.DRAFT)

        r = self.client.post(f"/api/tournaments/{t.pk}/open_registration/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)

        r = self.client.post(f"/api/tournaments/{t.pk}/start/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)

        r = self.client.post(f"/api/tournaments/{t.pk}/complete/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["status"], Tournament.Status.COMPLETED)


class TestAthleteRegistration(TournamentAPITestCase):
    """Тест 2: Тренер може зареєструвати спортсмена на категорію."""

    def test_coach_can_register_athlete(self):
        self._login(self.coach)
        athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Новий",
            last_name="Атлет",
            gender=Athlete.Gender.MALE,
            birth_date=date(2001, 5, 10),
            base_weight=73,
        )
        payload = {"athlete_id": athlete.pk, "category": self.category.pk}
        response = self.client.post("/api/registrations/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], Registration.Status.PENDING)

    def test_organizer_can_confirm_weigh_in(self):
        """Організатор підтверджує зважування — статус стає confirmed."""
        self._login(self.coach)
        athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Зважений",
            last_name="Атлет",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 3, 3),
            base_weight=73,
        )
        reg = Registration.objects.create(
            athlete=athlete,
            category=self.category,
            status=Registration.Status.PENDING,
        )

        self._login(self.organizer)
        response = self.client.post(
            f"/api/registrations/{reg.pk}/confirm_weigh_in/",
            {"weight": 73.4},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Registration.Status.CONFIRMED)


class TestBracketGeneration(TournamentAPITestCase):
    """Тест 3: Генерація сітки через API endpoint."""

    def test_generate_bracket_creates_matches(self):
        """POST /api/categories/{id}/generate_bracket/ → 7 матчів для 8 учасників."""
        # Створюємо 8 підтверджених реєстрацій
        for i in range(1, 9):
            club = self.club_a if i % 2 else self.club_b
            self._create_athlete(i, club=club)

        self._login(self.organizer)
        response = self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 7)

    def test_generate_bracket_twice_returns_error(self):
        """Повторна генерація повертає 400."""
        for i in range(1, 5):
            self._create_athlete(i)

        self._login(self.organizer)
        self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        response = self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_bracket_insufficient_participants(self):
        """Менше 2 учасників → 400."""
        self._create_athlete(1)
        self._login(self.organizer)
        response = self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
