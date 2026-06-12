from datetime import timedelta

import django.core.signing as signing
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.accounts.serializers import UserRegistrationSerializer
from apps.athletes.models import Athlete
from apps.tournaments.models import Category, Registration, Tournament


class RegistrationSerializerTest(TestCase):
    def test_passwords_must_match(self):
        data = {
            "email": "test@test.com",
            "first_name": "Test",
            "last_name": "Test",
            "role": "coach",
            "password": "password123",  # NOSONAR
            "password_confirm": "password_diff",  # NOSONAR
        }
        serializer = UserRegistrationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("password_confirm", serializer.errors)

    def test_valid_registration(self):
        data = {
            "email": "test2@test.com",
            "first_name": "Test2",
            "last_name": "Test2",
            "role": "coach",
            "password": "password123",  # NOSONAR
            "password_confirm": "password123",  # NOSONAR
        }
        serializer = UserRegistrationSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)


class VerifyPassViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.club = Club.objects.create(name="Тест Клуб", region="kyiv_oblast")
        self.organizer = User.objects.create_user(
            email="organizer@test.local",
            password="password123",  # NOSONAR
            first_name="Орг",
            last_name="Тест",
            role=User.Role.ORGANIZER,
            club=self.club,
        )
        self.athlete = Athlete.objects.create(
            first_name="Олексій",
            last_name="Іванов",
            patronymic="Петрович",
            birth_date="2010-05-15",
            gender="male",
            base_weight=55.5,
            club=self.club,
            coach=self.organizer,
        )
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Тестовий Турнір",
            sport_type="Карате",
            location="Тест Арена",
            start_date=timezone.now() + timedelta(days=30),
            end_date=timezone.now() + timedelta(days=31),
            status=Tournament.Status.REGISTRATION,
        )
        self.category = Category.objects.create(
            tournament=self.tournament,
            name="Юнаки 14-15 років, до 60 кг",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=14,
            max_age=15,
            min_weight=0,
            max_weight=60,
        )
        self.registration = Registration.objects.create(
            athlete=self.athlete,
            category=self.category,
            status="pending",
        )

    def test_verify_pass_no_token(self):
        url = reverse("verify-pass")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Токен є обов'язковим для верифікації.", response.data["detail"])

    def test_verify_pass_invalid_token(self):
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": "invalid-token"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Недійсний підпис бейджа", response.data["detail"])

    def test_verify_pass_valid_athlete_token(self):
        signer = signing.Signer(salt="qr-verification")
        token = signer.sign(f"ath:{self.athlete.id}")
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": token})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["type"], "athlete")
        self.assertEqual(response.data["data"]["id"], self.athlete.id)
        self.assertEqual(response.data["data"]["patronymic"], "Петрович")

    def test_verify_pass_athlete_not_found(self):
        signer = signing.Signer(salt="qr-verification")
        token = signer.sign("ath:999999")
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": token})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("Спортсмена не знайдено.", response.data["detail"])

    def test_verify_pass_valid_registration_token(self):
        signer = signing.Signer(salt="qr-verification")
        token = signer.sign(f"reg:{self.registration.id}")
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": token})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["type"], "registration")
        self.assertEqual(response.data["data"]["id"], self.registration.id)
        self.assertEqual(response.data["data"]["athlete"]["patronymic"], "Петрович")

    def test_verify_pass_registration_not_found(self):
        signer = signing.Signer(salt="qr-verification")
        token = signer.sign("reg:999999")
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": token})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("Заявку на реєстрацію не знайдено.", response.data["detail"])

    def test_verify_pass_invalid_token_format(self):
        signer = signing.Signer(salt="qr-verification")
        token = signer.sign("random_string")
        url = reverse("verify-pass")
        response = self.client.get(url, {"token": token})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Невірний формат токена.", response.data["detail"])


class AccountsAPITestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.club = Club.objects.create(name="Тестовий Клуб 1", region="kyiv_oblast")
        self.user_password = "password123"  # NOSONAR
        self.user = User.objects.create_user(
            email="test_user@demo.local",
            password=self.user_password,
            first_name="Іван",
            last_name="Іванов",
            role=User.Role.COACH,
            club=self.club,
        )
        self.admin = User.objects.create_user(
            email="admin_user@demo.local",
            password=self.user_password,
            first_name="Адмін",
            last_name="Тест",
            role=User.Role.ADMIN,
            is_staff=True,
        )

    def test_login_logout_me_endpoints(self):
        # 1. Login success
        payload = {"email": "test_user@demo.local", "password": self.user_password}
        response = self.client.post("/api/auth/login/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "test_user@demo.local")

        # 2. Get Me
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "test_user@demo.local")

        # 3. Logout
        response = self.client.post("/api/auth/logout/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # 4. Get Me unauthenticated -> 403
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_register_endpoint(self):
        payload = {
            "email": "new_coach@demo.local",
            "password": "password123",  # NOSONAR
            "password_confirm": "password123",  # NOSONAR
            "first_name": "Сергій",
            "last_name": "Сергієнко",
            "role": "coach",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["email"], "new_coach@demo.local")
        self.assertTrue(User.objects.filter(email="new_coach@demo.local").exists())

    def test_club_viewset_endpoints(self):
        # Anonymous can list clubs
        response = self.client.get("/api/auth/clubs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Anonymous can create club
        payload = {"name": "Новий Клуб", "region": "kyiv_oblast"}
        response = self.client.post("/api/auth/clubs/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        club_id = response.data["id"]

        # Anonymous cannot delete club -> 403
        response = self.client.delete(f"/api/auth/clubs/{club_id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Admin can delete club
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/auth/clubs/{club_id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_user_viewset_endpoints(self):
        # Spectator/Anonymous cannot access users list
        response = self.client.get("/api/auth/users/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Organizer can list and filter users
        organizer = User.objects.create_user(
            email="organizer_u@demo.local",
            password="password123",  # NOSONAR
            role=User.Role.ORGANIZER,
        )
        self.client.force_authenticate(user=organizer)

        # List all users
        response = self.client.get("/api/auth/users/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Filter by role
        response = self.client.get("/api/auth/users/?role=coach")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Filter by search
        response = self.client.get("/api/auth/users/?search=Іван")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Filter by ids
        response = self.client.get(f"/api/auth/users/?ids={self.user.id},{self.admin.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
