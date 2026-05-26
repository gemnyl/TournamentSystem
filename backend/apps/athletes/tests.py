"""Тести створення спортсменів із перевіркою автоматичного визначення клубу."""

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete


class AthleteCreationTestCase(TestCase):
    """Тести для створення атлетів різними ролями та з різними значеннями club_id."""

    def setUp(self):
        self.client = APIClient()
        self.club = Club.objects.create(name="Тестовий Клуб", region="Київ")

        # 1. Тренер із призначеним клубом
        self.coach_with_club = User.objects.create_user(
            email="coach_club@test.local",
            password="testpassword123",
            first_name="Тренер",
            last_name="Клубний",
            role=User.Role.COACH,
            club=self.club,
        )

        # 2. Тренер без клубу
        self.coach_no_club = User.objects.create_user(
            email="coach_noclub@test.local",
            password="testpassword123",
            first_name="Тренер",
            last_name="Безклубний",
            role=User.Role.COACH,
            club=None,
        )

        # 3. Організатор
        self.organizer = User.objects.create_user(
            email="org@test.local",
            password="testpassword123",
            first_name="Організатор",
            last_name="Тест",
            role=User.Role.ORGANIZER,
        )

    def test_coach_with_club_creates_athlete_without_club_id(self):
        """Тренер з клубом може створити атлета БЕЗ вказання club_id (201).
        Йому автоматично призначається клуб тренера.
        """
        self.client.force_authenticate(user=self.coach_with_club)
        payload = {
            "first_name": "Іван",
            "last_name": "Іванов",
            "gender": "male",
            "birth_date": "2010-05-15",
            "base_weight": 55.0,
            "skill_level": "1 кю",
        }
        response = self.client.post("/api/athletes/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["club"]["id"], self.club.id)

        # Перевіряємо в базі даних
        athlete = Athlete.objects.get(id=response.data["id"])
        self.assertEqual(athlete.club, self.club)
        self.assertEqual(athlete.coach, self.coach_with_club)

    def test_coach_without_club_creates_athlete_without_club_id_fails(self):
        """Тренер без клубу при спробі створити атлета без club_id отримує зрозумілу 400."""
        self.client.force_authenticate(user=self.coach_no_club)
        payload = {
            "first_name": "Петро",
            "last_name": "Петров",
            "gender": "male",
            "birth_date": "2011-06-20",
            "base_weight": 60.0,
            "skill_level": "2 кю",
        }
        response = self.client.post("/api/athletes/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("club_id", response.data)
        self.assertEqual(response.data["club_id"], "Вкажіть клуб або призначте клуб тренеру.")

    def test_organizer_creates_athlete_with_club_id(self):
        """Організатор може створити атлета з вказанням конкретного club_id (201)."""
        self.client.force_authenticate(user=self.organizer)
        payload = {
            "first_name": "Семен",
            "last_name": "Семенов",
            "gender": "male",
            "birth_date": "2009-02-10",
            "base_weight": 65.0,
            "skill_level": "3 кю",
            "club_id": self.club.id,
        }
        response = self.client.post("/api/athletes/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["club"]["id"], self.club.id)

        athlete = Athlete.objects.get(id=response.data["id"])
        self.assertEqual(athlete.club, self.club)
        self.assertEqual(athlete.coach, self.organizer)
