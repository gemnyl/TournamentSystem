from datetime import timedelta

import django.core.signing as signing
from django.test import RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.accounts.permissions import (
    IsTournamentChiefJudgeOrOrganizer,
    IsTournamentStaffOrOrganizer,
)
from apps.accounts.serializers import UserRegistrationSerializer
from apps.athletes.models import Athlete
from apps.matches.models import Match
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

        # 2.5. Try PATCH to update profile (attempt to change name and phone)
        patch_payload = {
            "first_name": "НовеІм'я",
            "last_name": "НовеПрізвище",
            "patronymic": "НовеПобатькові",
            "phone": "+380501111111",
        }
        response = self.client.patch("/api/auth/me/", patch_payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Check that phone is updated, but first_name, last_name, and patronymic are UNCHANGED
        self.assertEqual(response.data["phone"], "+380501111111")
        self.assertEqual(response.data["first_name"], "Іван")
        self.assertEqual(response.data["last_name"], "Іванов")
        self.assertEqual(response.data["patronymic"], "")

        # Verify changes persisted in DB
        self.user.refresh_from_db()
        self.assertEqual(self.user.phone, "+380501111111")
        self.assertEqual(self.user.first_name, "Іван")
        self.assertEqual(self.user.last_name, "Іванов")

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
            "club_id": self.club.id,
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["email"], "new_coach@demo.local")

        # User should exist in DB but be inactive
        user = User.objects.get(email="new_coach@demo.local")
        self.assertFalse(user.is_active)
        self.assertFalse(user.email_verified)
        self.assertEqual(user.role, User.Role.SPECTATOR)  # Role is spectator until approved

        # RoleRequest should be created
        from apps.accounts.models import EmailConfirmationCode, RoleRequest

        self.assertTrue(EmailConfirmationCode.objects.filter(user=user).exists())
        self.assertTrue(
            RoleRequest.objects.filter(user=user, requested_role="coach", club=self.club).exists()
        )

    def test_confirm_email(self):
        # 1. Create inactive user and confirmation code
        user = User.objects.create_user(
            email="inactive@demo.local",
            password="password123",  # NOSONAR
            first_name="Неактивний",
            last_name="Користувач",
            role=User.Role.SPECTATOR,
        )
        user.is_active = False
        user.email_verified = False
        user.save()

        from datetime import timedelta

        from django.utils import timezone

        from apps.accounts.models import EmailConfirmationCode

        EmailConfirmationCode.objects.create(
            user=user, code="123456", expires_at=timezone.now() + timedelta(minutes=15)
        )

        # 2. Confirm email with invalid code
        payload = {"email": "inactive@demo.local", "code": "000000"}
        response = self.client.post("/api/auth/confirm-email/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Confirm email with valid code
        payload = {"email": "inactive@demo.local", "code": "123456"}
        response = self.client.post("/api/auth/confirm-email/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "inactive@demo.local")

        # 4. Check user state
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.email_verified)
        self.assertFalse(EmailConfirmationCode.objects.filter(user=user).exists())

    def test_resend_confirmation_code(self):
        user = User.objects.create_user(
            email="inactive2@demo.local",
            password="password123",  # NOSONAR
            first_name="Неактивний2",
            last_name="Користувач2",
            role=User.Role.SPECTATOR,
        )
        user.is_active = False
        user.email_verified = False
        user.save()

        # Resend code
        payload = {"email": "inactive2@demo.local"}
        response = self.client.post("/api/auth/resend-confirmation/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        from apps.accounts.models import EmailConfirmationCode

        self.assertTrue(EmailConfirmationCode.objects.filter(user=user).exists())

    def test_change_password(self):
        self.client.force_authenticate(user=self.user)
        payload = {
            "old_password": self.user_password,
            "new_password": "newpassword123",  # NOSONAR
            "new_password_confirm": "newpassword123",  # NOSONAR
        }
        response = self.client.post("/api/auth/change-password/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Check password was updated
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("newpassword123"))

    def test_role_request_flow(self):
        # 1. Create a spectator user
        spectator = User.objects.create_user(
            email="spec@demo.local",
            password="password123",  # NOSONAR
            first_name="Глядач",
            last_name="Тестовий",
            role=User.Role.SPECTATOR,
            phone="+380998887766",
        )
        self.client.force_authenticate(user=spectator)

        # 2. Submit role request (Coach) without club -> 400
        payload = {"requested_role": "coach"}
        response = self.client.post("/api/auth/role-requests/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Submit role request (Coach) with club and document -> success
        from django.core.files.uploadedfile import SimpleUploadedFile

        doc_file = SimpleUploadedFile(
            "cert.pdf", b"dummy certificate pdf content", content_type="application/pdf"
        )

        payload = {
            "requested_role": "coach",
            "club_id": self.club.id,
            "details": "Маю чорний пояс",
            "document": doc_file,
        }
        response = self.client.post("/api/auth/role-requests/", payload, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        request_id = response.data["id"]

        # Check that user email and phone are present in serialized response
        self.assertEqual(response.data["user"]["email"], "spec@demo.local")
        self.assertEqual(response.data["user"]["phone"], "+380998887766")
        self.assertIsNotNone(response.data["document"])

        # 4. Review role request as another regular user -> 403
        self.client.force_authenticate(user=self.user)
        payload = {"status": "approved"}
        response = self.client.post(
            f"/api/auth/role-requests/{request_id}/review/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 5. Review role request as admin -> success
        self.client.force_authenticate(user=self.admin)
        payload = {"status": "approved", "review_notes": "Схвалено адміном"}
        response = self.client.post(
            f"/api/auth/role-requests/{request_id}/review/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "approved")

        # 6. Check user role updated
        spectator.refresh_from_db()
        self.assertEqual(spectator.role, User.Role.COACH)
        self.assertEqual(spectator.club, self.club)

    def test_role_request_with_club_name_and_photo_with_id(self):
        # 1. Create a spectator user
        spectator = User.objects.create_user(
            email="spec2@demo.local",
            password="password123",
            first_name="Другий",
            last_name="Глядач",
            role=User.Role.SPECTATOR,
            phone="+380991112233",
        )
        self.client.force_authenticate(user=spectator)

        # 2. Submit role request with a text club_name and photo_with_id
        from django.core.files.uploadedfile import SimpleUploadedFile

        doc_file = SimpleUploadedFile(
            "cert.pdf", b"dummy certificate", content_type="application/pdf"
        )
        photo_file = SimpleUploadedFile(
            "id_photo.jpg", b"dummy photo content", content_type="image/jpeg"
        )

        payload = {
            "requested_role": "coach",
            "club_name": "СК Нова Сакура",
            "details": "Головний тренер",
            "document": doc_file,
            "photo_with_id": photo_file,
        }
        response = self.client.post("/api/auth/role-requests/", payload, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        request_id = response.data["id"]

        # Assert club was dynamically created
        from apps.accounts.models import Club, RoleRequest

        self.assertTrue(Club.objects.filter(name="СК Нова Сакура").exists())
        club = Club.objects.get(name="СК Нова Сакура")

        # Verify role request details
        role_req = RoleRequest.objects.get(pk=request_id)
        self.assertEqual(role_req.club, club)
        self.assertTrue(bool(role_req.document))
        self.assertTrue(bool(role_req.photo_with_id))

        # Review role request as admin -> success and sets user's club
        self.client.force_authenticate(user=self.admin)
        review_payload = {"status": "approved", "review_notes": "Все окей"}
        response = self.client.post(
            f"/api/auth/role-requests/{request_id}/review/", review_payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Check spectator user upgraded
        spectator.refresh_from_db()
        self.assertEqual(spectator.role, User.Role.COACH)
        self.assertEqual(spectator.club, club)

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

    def test_save_override_updates_role(self):
        # 1. Create a spectator user
        spectator = User.objects.create_user(
            email="save_test@demo.local",
            password="password123",  # NOSONAR
            first_name="Тест",
            last_name="Збереження",
            role=User.Role.SPECTATOR,
        )
        # 2. Create a RoleRequest
        from apps.accounts.models import RoleRequest

        req = RoleRequest.objects.create(
            user=spectator,
            requested_role=User.Role.COACH,
            club=self.club,
            status=RoleRequest.Status.PENDING,
        )

        # 3. Change status directly to APPROVED and save
        req.status = RoleRequest.Status.APPROVED
        req.save()

        # 4. Check user role is updated automatically
        spectator.refresh_from_db()
        self.assertEqual(spectator.role, User.Role.COACH)
        self.assertEqual(spectator.club, self.club)

    def test_update_credit_limit(self):
        # Organizer cannot change limit
        organizer = User.objects.create_user(
            email="organizer_limit@demo.local",
            password="password123",  # NOSONAR
            role=User.Role.ORGANIZER,
        )
        self.client.force_authenticate(user=organizer)
        response = self.client.post(
            f"/api/auth/users/{organizer.id}/update_credit_limit/",
            {"credit_limit": 5000},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Admin can change limit
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            f"/api/auth/users/{organizer.id}/update_credit_limit/",
            {"credit_limit": 5000},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["credit_limit"], 5000)
        organizer.refresh_from_db()
        self.assertEqual(organizer.credit_limit, 5000)

        # Validation checks
        # 1. Missing credit_limit
        response = self.client.post(
            f"/api/auth/users/{organizer.id}/update_credit_limit/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Invalid credit_limit format
        response = self.client.post(
            f"/api/auth/users/{organizer.id}/update_credit_limit/",
            {"credit_limit": "invalid_value"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TournamentPermissionsTest(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.superuser = User.objects.create_superuser(
            email="perm_super@test.com", password="password"
        )
        self.organizer = User.objects.create_user(
            email="perm_org@test.com", password="password", role=User.Role.ORGANIZER
        )
        self.judge = User.objects.create_user(
            email="perm_judge@test.com", password="password", role=User.Role.JUDGE
        )
        self.coach = User.objects.create_user(
            email="perm_coach@test.com", password="password", role=User.Role.COACH
        )

        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            chief_judge=self.judge,
            title="Perm Test Tournament",
            sport_type="Judo",
            location="Dnipro",
            start_date="2026-06-25T10:00:00Z",
            end_date="2026-06-26T18:00:00Z",
            status=Tournament.Status.ACTIVE,
        )
        self.tournament.staff_members.add(self.coach)

        self.category = Category.objects.create(
            tournament=self.tournament,
            name="Perm Test Cat",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=10,
            max_age=99,
            min_weight=10,
            max_weight=150,
        )
        self.match = Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=1,
        )

    def test_is_tournament_staff_or_organizer(self):
        perm = IsTournamentStaffOrOrganizer()

        # GET request with query param tournament
        req = self.factory.get(f"/?tournament={self.tournament.id}")
        req.query_params = req.GET

        # Admin -> True
        req.user = self.superuser
        self.assertTrue(perm.has_permission(req, None))

        # Organizer -> True
        req.user = self.organizer
        self.assertTrue(perm.has_permission(req, None))

        # Staff coach -> True
        req.user = self.coach
        self.assertTrue(perm.has_permission(req, None))

        # Chief judge -> True
        req.user = self.judge
        self.assertTrue(perm.has_permission(req, None))

        # Other user not associated
        other_user = User.objects.create_user(
            email="perm_other@test.com", password="password", role=User.Role.JUDGE
        )
        req.user = other_user
        self.assertFalse(perm.has_permission(req, None))

        # Test POST request payload resolution of category
        req_post = self.factory.post("/")
        req_post.data = {"category_id": self.category.id}
        req_post.user = other_user
        self.assertFalse(perm.has_permission(req_post, None))

        # Test POST request payload resolution of match
        req_post_match = self.factory.post("/")
        req_post_match.data = {"match": self.match.id}
        req_post_match.user = self.coach
        self.assertTrue(perm.has_permission(req_post_match, None))

    def test_is_tournament_chief_judge_or_organizer(self):
        perm = IsTournamentChiefJudgeOrOrganizer()

        req = self.factory.get(f"/?tournament={self.tournament.id}")
        req.query_params = req.GET

        # Chief judge -> True
        req.user = self.judge
        self.assertTrue(perm.has_permission(req, None))

        # Staff coach -> False (not chief judge)
        req.user = self.coach
        self.assertFalse(perm.has_permission(req, None))

        # Test has_object_permission
        req_obj = self.factory.get("/")
        req_obj.user = self.judge
        self.assertTrue(perm.has_object_permission(req_obj, None, self.match))

        req_obj.user = self.coach
        self.assertFalse(perm.has_object_permission(req_obj, None, self.match))


class PasswordResetTest(TestCase):
    def setUp(self):
        from apps.accounts.views import (
            ConfirmPasswordResetView,
            LoginView,
            RequestPasswordResetView,
        )

        RequestPasswordResetView.throttle_classes = []
        ConfirmPasswordResetView.throttle_classes = []
        LoginView.throttle_classes = []

        self.client = APIClient()
        self.user = User.objects.create_user(
            email="reset@test.local",
            password="oldpassword123",  # NOSONAR
            first_name="Reset",
            last_name="User",
            role=User.Role.COACH,
        )

    def test_request_password_reset_success(self):
        from apps.accounts.models import PasswordResetCode

        url = reverse("auth-password-reset-request")
        response = self.client.post(url, {"email": "reset@test.local"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(PasswordResetCode.objects.filter(user=self.user).exists())
        code_obj = PasswordResetCode.objects.get(user=self.user)
        self.assertEqual(len(code_obj.code), 6)
        self.assertTrue(code_obj.code.isdigit())

    def test_request_password_reset_nonexistent_email(self):
        from apps.accounts.models import PasswordResetCode

        url = reverse("auth-password-reset-request")
        response = self.client.post(url, {"email": "nonexistent@test.local"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(
            PasswordResetCode.objects.filter(user__email="nonexistent@test.local").exists()
        )

    def test_confirm_password_reset_success(self):
        from apps.accounts.models import PasswordResetCode

        # First request the code
        request_url = reverse("auth-password-reset-request")
        self.client.post(request_url, {"email": "reset@test.local"})
        code_obj = PasswordResetCode.objects.get(user=self.user)

        # Confirm the reset
        confirm_url = reverse("auth-password-reset-confirm")
        response = self.client.post(
            confirm_url,
            {
                "email": "reset@test.local",
                "code": code_obj.code,
                "new_password": "newpassword123",  # NOSONAR
            },
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(PasswordResetCode.objects.filter(user=self.user).exists())

        # Verify password is changed by logging in
        login_url = reverse("auth-login")
        login_response = self.client.post(
            login_url,
            {
                "email": "reset@test.local",
                "password": "newpassword123",  # NOSONAR
            },
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

    def test_confirm_password_reset_invalid_code(self):
        request_url = reverse("auth-password-reset-request")
        self.client.post(request_url, {"email": "reset@test.local"})

        confirm_url = reverse("auth-password-reset-confirm")
        response = self.client.post(
            confirm_url,
            {
                "email": "reset@test.local",
                "code": "000000",
                "new_password": "newpassword123",  # NOSONAR
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Невірний код підтвердження.", response.data["detail"])

    def test_confirm_password_reset_expired_code(self):
        from apps.accounts.models import PasswordResetCode

        request_url = reverse("auth-password-reset-request")
        self.client.post(request_url, {"email": "reset@test.local"})
        code_obj = PasswordResetCode.objects.get(user=self.user)
        # Force code expiration
        code_obj.expires_at = timezone.now() - timedelta(minutes=1)
        code_obj.save()

        confirm_url = reverse("auth-password-reset-confirm")
        response = self.client.post(
            confirm_url,
            {
                "email": "reset@test.local",
                "code": code_obj.code,
                "new_password": "newpassword123",  # NOSONAR
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Термін дії коду закінчився.", response.data["detail"])

    def test_confirm_password_reset_same_password(self):
        from apps.accounts.models import PasswordResetCode

        request_url = reverse("auth-password-reset-request")
        self.client.post(request_url, {"email": "reset@test.local"})
        code_obj = PasswordResetCode.objects.get(user=self.user)

        confirm_url = reverse("auth-password-reset-confirm")
        response = self.client.post(
            confirm_url,
            {
                "email": "reset@test.local",
                "code": code_obj.code,
                "new_password": "oldpassword123",  # Same as current
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Новий пароль не може збігатися з поточним.", response.data["detail"])
