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

from django.test import TestCase, override_settings
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
            password="test12345",  # NOSONAR
            first_name="Органіс",
            last_name="Таторенко",
            role=User.Role.ORGANIZER,
            club=self.club_a,
        )
        self.coach = User.objects.create_user(
            email="coach@test.local",
            password="test12345",  # NOSONAR
            first_name="Тренер",
            last_name="Коченко",
            role=User.Role.COACH,
            club=self.club_a,
        )
        self.judge = User.objects.create_user(
            email="judge@test.local",
            password="test12345",  # NOSONAR
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
            name="Чоловіки -75кг (Турнір)",
            tournament=self.tournament,
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

    def _create_athlete(self, idx, club=None, category=None):
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
            category=category or self.category,
            seed_number=idx,
            recorded_weight=73,
            status=Registration.Status.CONFIRMED,
            payment_status="paid",
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

    def test_staff_can_check_in_and_confirm_weigh_in(self):
        """Персонал турніру може відмічати явку та підтверджувати зважування."""
        # Create staff user
        staff_user = User.objects.create_user(
            email="staff@test.local",
            password="test12345",  # NOSONAR
            first_name="Секретар",
            last_name="Турнірний",
            role=User.Role.STAFF,
        )
        # Assign staff to tournament
        self.tournament.staff_members.add(staff_user)

        athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Тест",
            last_name="Явка",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 3, 3),
            base_weight=73,
        )
        reg = Registration.objects.create(
            athlete=athlete,
            category=self.category,
            status=Registration.Status.PENDING,
        )

        # Login as staff
        self._login(staff_user)

        # Test check-in toggle
        response = self.client.post(f"/api/registrations/{reg.pk}/check_in/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["checked_in"])

        # Test check-in toggle off
        response = self.client.post(f"/api/registrations/{reg.pk}/check_in/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["checked_in"])

        # Test weigh-in confirm by staff
        response = self.client.post(
            f"/api/registrations/{reg.pk}/confirm_weigh_in/",
            {"weight": 74.2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Registration.Status.CONFIRMED)
        self.assertEqual(float(response.data["recorded_weight"]), 74.2)

    def test_unauthorized_user_cannot_check_in(self):
        """Інший тренер або сторонній персонал не може відмітити явку."""
        other_coach = User.objects.create_user(
            email="other_coach@test.local",
            password="test12345",  # NOSONAR
            first_name="Інший",
            last_name="Тренер",
            role=User.Role.COACH,
        )
        athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Тест",
            last_name="Явка",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 3, 3),
            base_weight=73,
        )
        reg = Registration.objects.create(
            athlete=athlete,
            category=self.category,
            status=Registration.Status.PENDING,
        )

        self._login(other_coach)
        response = self.client.post(f"/api/registrations/{reg.pk}/check_in/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_validate_status_change_weight_constraints(self):
        """Зміна статусу на confirmed через PATCH перевіряє вагу, якщо weigh-in обов'язкове."""
        athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club_a,
            first_name="Тест",
            last_name="Вага",
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

        # 1. No weight set (should fail)
        response = self.client.patch(
            f"/api/registrations/{reg.pk}/",
            {"status": Registration.Status.CONFIRMED},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        data = response.data
        error_msg = data[0] if isinstance(data, list) else data.get("non_field_errors", [""])[0]
        self.assertIn("без проходження зважування", error_msg)

        # 2. Invalid weight (65.0 < 70)
        reg.recorded_weight = 65.0
        reg.save(update_fields=["recorded_weight"])
        response = self.client.patch(
            f"/api/registrations/{reg.pk}/",
            {"status": Registration.Status.CONFIRMED},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        data = response.data
        error_msg = data[0] if isinstance(data, list) else data.get("non_field_errors", [""])[0]
        self.assertIn("менша за мінімально допустиму", error_msg)

        # 3. Valid weight (72.0)
        reg.recorded_weight = 72.0
        reg.save(update_fields=["recorded_weight"])
        response = self.client.patch(
            f"/api/registrations/{reg.pk}/",
            {"status": Registration.Status.CONFIRMED},
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

    def test_generate_bracket_with_custom_format(self):
        """Зміна формату при генерації сітки."""
        for i in range(1, 3):
            self._create_athlete(i)
        self._login(self.organizer)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/generate_bracket/",
            {"bracket_format": "round_robin"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.category.refresh_from_db()
        self.assertEqual(self.category.bracket_format, "round_robin")

    def test_delete_bracket(self):
        """Видалення згенерованої сітки."""
        for i in range(1, 3):
            self._create_athlete(i)
        self._login(self.organizer)
        self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        self.assertTrue(self.category.matches.exists())

        response = self.client.post(f"/api/categories/{self.category.pk}/delete_bracket/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(self.category.matches.exists())

    def test_generate_all_brackets(self):
        """Генерація сіток для всього турніру."""
        for i in range(1, 3):
            self._create_athlete(i)
        self._login(self.organizer)

        response = self.client.post(f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(self.category.matches.exists())

    def test_generate_all_brackets_with_rules(self):
        """Групова генерація сіток з новими правилами rules."""
        self._login(self.organizer)

        # Створимо додаткову категорію
        cat_de = Category.objects.create(
            tournament=self.tournament,
            name="Cat DE",
            allowed_gender="mixed",
            min_age=18,
            max_age=30,
        )

        # Додамо 3 бійців у першу категорію (для Round Robin)
        for i in range(1, 4):
            self._create_athlete(i, category=self.category)

        # Додамо 6 бійців у категорію cat_de (для Double Elimination)
        for i in range(10, 16):
            self._create_athlete(i, category=cat_de)

        payload = {
            "rules": [
                {
                    "format": Category.BracketFormat.ROUND_ROBIN,
                    "min_participants": 2,
                    "max_participants": 5,
                },
                {
                    "format": Category.BracketFormat.DOUBLE_ELIMINATION,
                    "double_elim_type": Category.DoubleElimType.FULL,
                    "min_participants": 6,
                    "max_participants": 16,
                },
            ]
        }

        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.category.refresh_from_db()
        cat_de.refresh_from_db()

        self.assertEqual(self.category.bracket_format, Category.BracketFormat.ROUND_ROBIN)
        self.assertEqual(cat_de.bracket_format, Category.BracketFormat.DOUBLE_ELIMINATION)
        self.assertEqual(cat_de.double_elim_type, Category.DoubleElimType.FULL)
        self.assertTrue(self.category.matches.exists())
        self.assertTrue(cat_de.matches.exists())

    def test_generate_all_brackets_invalid_rules(self):
        """Групова генерація з неправильними правилами повертає 400."""
        self._login(self.organizer)

        payload_bad_format = {
            "rules": [
                {"format": "invalid_format_name", "min_participants": 2, "max_participants": 5}
            ]
        }
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/",
            payload_bad_format,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        payload_bad_type = {
            "rules": [
                {
                    "format": Category.BracketFormat.DOUBLE_ELIMINATION,
                    "double_elim_type": "invalid_type",
                    "min_participants": 2,
                    "max_participants": 5,
                }
            ]
        }
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/",
            payload_bad_type,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_all_brackets_invalid_participants_type(self):
        """Групова генерація з неправильним типом учасників повертає 400."""
        self._login(self.organizer)

        payload = {
            "rules": [
                {
                    "format": Category.BracketFormat.ROUND_ROBIN,
                    "min_participants": "not_an_int",
                    "max_participants": 5,
                }
            ]
        }
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_registration_blocked_if_not_registration_status(self):
        """Реєстрація спортсменів блокується, якщо статус не 'registration'."""
        self.tournament.status = Tournament.Status.ACTIVE
        self.tournament.save(update_fields=["status"])

        self._login(self.coach)
        athlete = Athlete.objects.create(
            first_name="BlockedName",
            last_name="BlockedLastName",
            coach=self.coach,
            club=self.club_b,
            gender=Athlete.Gender.FEMALE,
            birth_date=date(2002, 6, 20),
            base_weight=65.0,
        )
        response = self.client.post(
            "/api/registrations/",
            {"athlete_id": athlete.pk, "category": self.category.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "Реєстрація можлива лише тоді",
            response.data[0] if isinstance(response.data, list) else str(response.data),
        )


class TestCategoryNLPImport(TournamentAPITestCase):
    """Тести для розумного bulk NLP-імпорту категорій."""

    def test_bulk_import_categories_success(self):
        self._login(self.organizer)
        payload = {
            "names": [
                "12-13 років, хлопці, до 40 кг",
                "12-13 років, дівчата, до 45 кг",
                "14-15 років, хлопці, понад 60 кг",
                "16-17 років, хлопці, 55-60 кг",
                "U10, -30kg, Male",
            ]
        }
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/import_categories/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 5)

        # 1. Check "12-13 років, хлопці, до 40 кг"
        cat1 = Category.objects.get(
            name="12-13 років, хлопці, до 40 кг", tournament=self.tournament
        )
        self.assertEqual(cat1.allowed_gender, Category.AllowedGender.MALE)
        self.assertEqual(cat1.min_age, 12)
        self.assertEqual(cat1.max_age, 13)
        self.assertIsNone(cat1.min_weight)
        self.assertEqual(float(cat1.max_weight), 40.0)

        # 2. Check "12-13 років, дівчата, до 45 кг"
        cat2 = Category.objects.get(
            name="12-13 років, дівчата, до 45 кг", tournament=self.tournament
        )
        self.assertEqual(cat2.allowed_gender, Category.AllowedGender.FEMALE)
        self.assertEqual(cat2.min_age, 12)
        self.assertEqual(cat2.max_age, 13)
        self.assertIsNone(cat2.min_weight)
        self.assertEqual(float(cat2.max_weight), 45.0)

        # 3. Check "14-15 років, хлопці, понад 60 кг"
        cat3 = Category.objects.get(
            name="14-15 років, хлопці, понад 60 кг", tournament=self.tournament
        )
        self.assertEqual(cat3.allowed_gender, Category.AllowedGender.MALE)
        self.assertEqual(cat3.min_age, 14)
        self.assertEqual(cat3.max_age, 15)
        self.assertEqual(float(cat3.min_weight), 60.0)
        self.assertIsNone(cat3.max_weight)

        # 4. Check "16-17 років, хлопці, 55-60 кг"
        cat4 = Category.objects.get(
            name="16-17 років, хлопці, 55-60 кг", tournament=self.tournament
        )
        self.assertEqual(cat4.allowed_gender, Category.AllowedGender.MALE)
        self.assertEqual(cat4.min_age, 16)
        self.assertEqual(cat4.max_age, 17)
        self.assertEqual(float(cat4.min_weight), 55.0)
        self.assertEqual(float(cat4.max_weight), 60.0)

        # 5. Check "U10, -30kg, Male"
        cat5 = Category.objects.get(name="U10, -30kg, Male", tournament=self.tournament)
        self.assertEqual(cat5.allowed_gender, Category.AllowedGender.MALE)
        self.assertEqual(cat5.min_age, 0)
        self.assertEqual(cat5.max_age, 10)
        self.assertIsNone(cat5.min_weight)
        self.assertEqual(float(cat5.max_weight), 30.0)

    def test_parse_category_name_various_formats(self):
        from apps.tournaments.views import parse_category_name

        # Test genders
        res = parse_category_name("boy 18+", "Karate")
        self.assertEqual(res["allowed_gender"], Category.AllowedGender.MALE)

        res = parse_category_name("girl 18+", "Karate")
        self.assertEqual(res["allowed_gender"], Category.AllowedGender.FEMALE)

        res = parse_category_name("mixed 18+", "Karate")
        self.assertEqual(res["allowed_gender"], Category.AllowedGender.MIXED)

        # Test age formats
        # Plus match: 18 і старше / 18 years and older / 18+
        res = parse_category_name("18 років і старше", "Karate")
        self.assertEqual(res["min_age"], 18)
        self.assertEqual(res["max_age"], 99)

        # Under match: до 18 років / under 18 yo
        res = parse_category_name("under 18 yo", "Karate")
        self.assertEqual(res["min_age"], 0)
        self.assertEqual(res["max_age"], 18)

        # Simple age: 12 років / 12 yo
        res = parse_category_name("12 yo", "Karate")
        self.assertEqual(res["min_age"], 12)
        self.assertEqual(res["max_age"], 12)

        # Test weight formats
        # w_under: under 45 / -30 / до 40 кг
        res = parse_category_name("18+ under 45kg", "Karate")
        self.assertIsNone(res["min_weight"])
        self.assertEqual(res["max_weight"], 45.0)

        # w_over: over 70 / 70+ / 70 plus / від 70
        res = parse_category_name("18+ over 70 plus", "Karate")
        self.assertEqual(res["min_weight"], 70.0)
        self.assertIsNone(res["max_weight"])

        res = parse_category_name("18+ 70 plus", "Karate")
        self.assertEqual(res["min_weight"], 70.0)
        self.assertIsNone(res["max_weight"])

        res = parse_category_name("18+ 70+", "Karate")
        self.assertEqual(res["min_weight"], 70.0)
        self.assertIsNone(res["max_weight"])

        res = parse_category_name("18+ 70 плюс", "Karate")
        self.assertEqual(res["min_weight"], 70.0)
        self.assertIsNone(res["max_weight"])

        # Ruleset key based on sport type
        res = parse_category_name("18+", "Shobu Ippon")
        self.assertEqual(res["ruleset_key"], "shobu_ippon")

        # Invalid weight digits causing ValueError on conversion
        res = parse_category_name("18+ .+", "Karate")
        self.assertIsNone(res["min_weight"])
        res = parse_category_name("18+ .plus", "Karate")
        self.assertIsNone(res["min_weight"])

        # Test bracket format parsing
        res = parse_category_name("18+ (Кругова сітка)", "Karate")
        self.assertEqual(res["bracket_format"], Category.BracketFormat.ROUND_ROBIN)

        res = parse_category_name("18+ (Швейцарська)", "Karate")
        self.assertEqual(res["bracket_format"], Category.BracketFormat.SWISS)

        res = parse_category_name("18+ (репешаж)", "Karate")
        self.assertEqual(res["bracket_format"], Category.BracketFormat.SINGLE_ELIM_REPECHAGE)

        res = parse_category_name("18+ (double)", "Karate")
        self.assertEqual(res["bracket_format"], Category.BracketFormat.DOUBLE_ELIMINATION)

        # Robust ruleset parsing tests
        res = parse_category_name("boy 12-14yo", "тхекводно")
        self.assertEqual(res["ruleset_key"], "taekwondo_wt")

        res = parse_category_name("boy judo 10+", "any sport")
        self.assertEqual(res["ruleset_key"], "judo_ijf")

        res = parse_category_name("ката дівчата", "karate")
        self.assertEqual(res["ruleset_key"], "karate_kata")

        # Ukrainian sport_type inputs
        res = parse_category_name("12-13 років, хлопці, -40 кг", "дзюдо")
        self.assertEqual(res["ruleset_key"], "judo_ijf")
        res = parse_category_name("14-15 років, дівчата, до 45 кг", "Дзюдо")
        self.assertEqual(res["ruleset_key"], "judo_ijf")
        res = parse_category_name("10-11 років, хлопці, -30 кг", "Тхеквондо")
        self.assertEqual(res["ruleset_key"], "taekwondo_wt")
        res = parse_category_name("10-11 років, хлопці, -30 кг", "Карате")
        self.assertEqual(res["ruleset_key"], "karate_wkf")


class CategoryResultsTestCase(TournamentAPITestCase):
    """Тести для розрахунку результатів категорії (Results Engine)."""

    def _find_match(self, matches, r_a, r_b):
        return [
            m
            for m in matches
            if (m.reg_first_id == r_a.id and m.reg_second_id == r_b.id)
            or (m.reg_first_id == r_b.id and m.reg_second_id == r_a.id)
        ][0]

    def _play_match(self, matches, r_winner, r_loser, score_winner, score_loser):
        from apps.matches.models import Match

        m = self._find_match(matches, r_winner, r_loser)
        m.status = Match.Status.COMPLETED
        m.winner = r_winner
        if m.reg_first_id == r_winner.id:
            m.score_first = score_winner
            m.score_second = score_loser
        else:
            m.score_first = score_loser
            m.score_second = score_winner
        m.save()
        return m

    def test_single_elimination_results(self):
        from apps.brackets.services import BracketGenerator
        from apps.matches.models import Match
        from apps.tournaments.services import calculate_category_standings

        # Створюємо 4 атлетів (вони автоматично реєструються у self.category)
        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)
        _, r3 = self._create_athlete(3)
        _, r4 = self._create_athlete(4)

        # Генерація сітки
        matches = BracketGenerator(self.category).generate()
        self.assertEqual(len(matches), 3)  # 2 півфінали + 1 фінал

        # Знаходимо півфінали та фінал
        semi_1 = [m for m in matches if m.round_index == 1 and m.match_order == 1][0]
        semi_2 = [m for m in matches if m.round_index == 1 and m.match_order == 2][0]
        final = [m for m in matches if m.round_index == 2][0]

        # Завершуємо півфінали
        # semi_1: r1 vs r2 -> winner r1
        semi_1.winner = r1
        semi_1.status = Match.Status.COMPLETED
        semi_1.save()

        # semi_2: r3 vs r4 -> winner r3
        semi_2.winner = r3
        semi_2.status = Match.Status.COMPLETED
        semi_2.save()

        # Оновлюємо фіналістів
        final.reg_first = r1
        final.reg_second = r3
        final.save()

        # Завершуємо фінал: r1 vs r3 -> winner r1
        final.winner = r1
        final.status = Match.Status.COMPLETED
        final.save()

        # Розраховуємо результати
        calculate_category_standings(self.category, persist=True)

        # Перевіряємо місця
        r1.refresh_from_db()
        r2.refresh_from_db()
        r3.refresh_from_db()
        r4.refresh_from_db()

        self.assertEqual(r1.place, 1)  # переможець фіналу
        self.assertEqual(r3.place, 2)  # той, хто програв у фіналі
        self.assertEqual(r2.place, 3)  # програв у півфіналі 1
        self.assertEqual(r4.place, 3)  # програв у півфіналі 2

    def test_round_robin_results(self):
        from apps.brackets.services import BracketGenerator
        from apps.tournaments.services import calculate_category_standings

        # Змінюємо формат категорії на круговий
        self.category.bracket_format = Category.BracketFormat.ROUND_ROBIN
        self.category.save()

        # Створюємо 3 атлетів
        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)
        _, r3 = self._create_athlete(3)

        matches = BracketGenerator(self.category).generate()
        self.assertEqual(len(matches), 3)  # кожен з кожним = 3 матчі

        # Зіграємо сутички:
        # Match 1: r1 vs r2. Winner r1, score 3:0
        self._play_match(matches, r1, r2, 3, 0)

        # Match 2: r2 vs r3. Winner r2, score 2:1
        self._play_match(matches, r2, r3, 2, 1)

        # Match 3: r3 vs r1. Winner r3, score 1:0
        self._play_match(matches, r3, r1, 1, 0)

        # Розраховуємо та зберігаємо результати
        calculate_category_standings(self.category, persist=True)

        r1.refresh_from_db()
        r2.refresh_from_db()
        r3.refresh_from_db()

        # Перевіримо tie-breakers:
        # Всі мають по 1 перемозі, 3 очки.
        # Різниця балів:
        # r1: 3 набрав, 1 пропустив (+2)
        # r2: 2 набрав, 4 пропустив (-2)
        # r3: 2 набрав, 2 пропустив (0)
        # Тому: r1 (1 місце), r3 (2 місце), r2 (3 місце)
        self.assertEqual(r1.place, 1)
        self.assertEqual(r3.place, 2)
        self.assertEqual(r2.place, 3)

    def test_single_elimination_one_third_place(self):
        from apps.brackets.services import BracketGenerator
        from apps.matches.models import Match
        from apps.tournaments.services import calculate_category_standings

        # Set two_third_places to False
        self.category.two_third_places = False
        self.category.save()

        # Create 4 athletes
        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)
        _, r3 = self._create_athlete(3)
        _, r4 = self._create_athlete(4)

        matches = BracketGenerator(self.category).generate()
        self.assertEqual(len(matches), 3)

        semi_1 = [m for m in matches if m.round_index == 1 and m.match_order == 1][0]
        semi_2 = [m for m in matches if m.round_index == 1 and m.match_order == 2][0]
        final = [m for m in matches if m.round_index == 2][0]

        # semi_1: r1 vs r2. Winner r1, score 5:1 (r2 gets 1 score)
        semi_1.reg_first = r1
        semi_1.reg_second = r2
        semi_1.winner = r1
        semi_1.score_first = 5
        semi_1.score_second = 1
        semi_1.status = Match.Status.COMPLETED
        semi_1.save()

        # semi_2: r3 vs r4. Winner r3, score 5:0 (r4 gets 0 score)
        semi_2.reg_first = r3
        semi_2.reg_second = r4
        semi_2.winner = r3
        semi_2.score_first = 5
        semi_2.score_second = 0
        semi_2.status = Match.Status.COMPLETED
        semi_2.save()

        # Final
        final.reg_first = r1
        final.reg_second = r3
        final.winner = r1
        final.status = Match.Status.COMPLETED
        final.save()

        calculate_category_standings(self.category, persist=True)

        r1.refresh_from_db()
        r2.refresh_from_db()
        r3.refresh_from_db()
        r4.refresh_from_db()

        self.assertEqual(r1.place, 1)
        self.assertEqual(r3.place, 2)
        # r2 has 1 score_scored vs r4 has 0 score_scored.
        # r2 should get place 3, and r4 should get place 5.
        self.assertEqual(r2.place, 3)
        self.assertEqual(r4.place, 5)

    def test_round_robin_two_way_tie_breaker(self):
        from apps.brackets.services import BracketGenerator
        from apps.tournaments.services import calculate_category_standings

        self.category.bracket_format = Category.BracketFormat.ROUND_ROBIN
        self.category.save()

        # 3 participants
        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)
        _, r3 = self._create_athlete(3)

        matches = BracketGenerator(self.category).generate()

        # Match 1: r1 vs r2. Winner r1, score 1:0
        self._play_match(matches, r1, r2, 1, 0)

        # Match 2: r2 vs r3. Winner r2, score 1:0
        self._play_match(matches, r2, r3, 1, 0)

        # Match 3: r3 vs r1. Winner r3, score 1:0
        self._play_match(matches, r3, r1, 1, 0)

        calculate_category_standings(self.category, persist=True)

        r1.refresh_from_db()
        r2.refresh_from_db()
        r3.refresh_from_db()

        # Everyone has 1 win, 3 points, same score difference (+0), same scores scored (1).
        # H2H is a cycle, so they tie completely.
        self.assertIn(r1.place, [1, 2, 3])
        self.assertIn(r2.place, [1, 2, 3])
        self.assertIn(r3.place, [1, 2, 3])

    def test_unknown_bracket_format_fallback(self):
        from apps.tournaments.services import calculate_category_standings

        self.category.bracket_format = "unknown_format"
        self.category.save()

        self._create_athlete(1)
        self._create_athlete(2)

        results = calculate_category_standings(self.category, persist=True)
        # Should not crash, and should return stats dicts
        self.assertEqual(len(results), 2)

    def test_category_results_endpoints(self):
        # 1. GET /api/categories/{id}/results/ without login is allowed (AllowAny)
        response = self.client.get(f"/api/categories/{self.category.pk}/results/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # 2. POST /api/categories/{id}/save_results/ without login is 403 (IsOrganizer required)
        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 3. POST /api/categories/{id}/save_results/ with coach login is 403 (IsOrganizer required)
        self._login(self.coach)
        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 4. POST /api/categories/{id}/save_results/ with organizer login should succeed (200 OK)
        self._login(self.organizer)
        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_round_robin_results_with_draw(self):
        from apps.brackets.services import BracketGenerator
        from apps.matches.models import Match
        from apps.tournaments.services import calculate_category_standings

        self.category.bracket_format = Category.BracketFormat.ROUND_ROBIN
        self.category.save()

        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)

        matches = BracketGenerator(self.category).generate()

        # Match: r1 vs r2 ends in a draw
        m = matches[0]
        m.status = Match.Status.COMPLETED
        m.winner = None
        m.win_method = Match.WinMethod.DRAW
        m.score_first = 1
        m.score_second = 1
        m.save()

        calculate_category_standings(self.category, persist=True)
        r1.refresh_from_db()
        r2.refresh_from_db()

        # Both should have 1 point, 1 draw, same scores
        self.assertEqual(r1.place, 1)
        self.assertEqual(r2.place, 2)

    def test_round_robin_two_way_tie_h2h_winner(self):
        from apps.brackets.services import BracketGenerator
        from apps.tournaments.services import calculate_category_standings

        self.category.bracket_format = Category.BracketFormat.ROUND_ROBIN
        self.category.save()

        _, r1 = self._create_athlete(1)
        _, r2 = self._create_athlete(2)

        matches = BracketGenerator(self.category).generate()

        # Match 1: r1 vs r2. Winner r1
        self._play_match(matches, r1, r2, 2, 0)

        calculate_category_standings(self.category, persist=True)
        r1.refresh_from_db()
        r2.refresh_from_db()

        self.assertEqual(r1.place, 1)
        self.assertEqual(r2.place, 2)


class TestTournamentExtraActions(TournamentAPITestCase):
    def _generate_bracket_setup(self):
        self._create_athlete(1)
        self._create_athlete(2)
        self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")

    def test_auto_distribute_tatamis_no_active_tatamis(self):
        self._login(self.organizer)
        # 1. No tatamis exist at all
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/auto_distribute_tatamis/"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Немає активних татамі", response.data["detail"])

    def test_auto_distribute_tatamis_no_categories_with_matches(self):
        self._login(self.organizer)
        from apps.tatamis.models import Tatami

        Tatami.objects.create(tournament=self.tournament, number=1, is_active=True)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/auto_distribute_tatamis/"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Немає категорій зі згенерованими сітками", response.data["detail"])

    def test_auto_distribute_tatamis_success(self):
        self._login(self.organizer)
        from apps.tatamis.models import Tatami

        t1 = Tatami.objects.create(tournament=self.tournament, number=1, is_active=True)
        Tatami.objects.create(tournament=self.tournament, number=2, is_active=True)

        # Generate a bracket so category has matches
        self._generate_bracket_setup()

        # Assign a mock current_match to a tatami to test clearing it
        match = self.category.matches.first()
        t1.current_match = match
        t1.save()

        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/auto_distribute_tatamis/"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        t1.refresh_from_db()
        self.assertIsNone(t1.current_match)

    def test_assign_tatami_validation(self):
        self._login(self.organizer)
        # Missing tatami_id
        response = self.client.post(f"/api/categories/{self.category.pk}/assign_tatami/", {})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid tatami_id
        response = self.client.post(
            f"/api/categories/{self.category.pk}/assign_tatami/", {"tatami_id": 9999}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_assign_tatami_success(self):
        self._login(self.organizer)
        from apps.tatamis.models import Tatami

        t1 = Tatami.objects.create(tournament=self.tournament, number=1)
        t2 = Tatami.objects.create(tournament=self.tournament, number=2)

        self._generate_bracket_setup()
        match = self.category.matches.first()

        # Set t2 as having match as current
        t2.current_match = match
        t2.save()

        # Assign to t1, clearing t2.current_match (covers L474-476)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/assign_tatami/", {"tatami_id": t1.id}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        match.refresh_from_db()
        self.assertEqual(match.tatami_id, t1.id)
        t2.refresh_from_db()
        self.assertIsNone(t2.current_match)

    def test_set_judges_count_validation(self):
        self._login(self.organizer)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/", {"judges_count": 4}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_set_judges_count_success(self):
        self._login(self.organizer)
        self.category.ruleset_key = "karate_kata"
        self.category.save()

        self._generate_bracket_setup()

        response = self.client.post(
            f"/api/categories/{self.category.pk}/set_judges_count/", {"judges_count": 5}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.category.refresh_from_db()
        self.assertEqual(self.category.judges_count, 5)

    def test_set_judges_count_validation_error(self):
        self._login(self.organizer)
        self.category.ruleset_key = "karate_kata"
        self.category.save()

        self._generate_bracket_setup()

        # Mark match as completed to trigger validation flow
        match = self.category.matches.first()
        from apps.matches.models import Match

        match.status = Match.Status.COMPLETED
        match.save()

        # Mock can_reset_match to fail (covers L640-642)
        from unittest.mock import patch

        with patch("apps.matches.services.match_service.MatchService.can_reset_match") as mock_can:
            mock_can.return_value = (False, "Mock reset error")
            response = self.client.post(
                f"/api/categories/{self.category.pk}/set_judges_count/", {"judges_count": 3}
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_save_results_with_overrides(self):
        self._login(self.organizer)
        from apps.tatamis.models import Tatami

        t = Tatami.objects.create(tournament=self.tournament, number=1)

        self._generate_bracket_setup()
        match = self.category.matches.first()
        t.current_match = match
        t.active_results_category = self.category
        t.save()

        reg = self.category.registrations.first()

        # 1. Valid override (covers L546 tatami broadcast)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/save_results/",
            {"overrides": {str(reg.id): 1}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        reg.refresh_from_db()
        self.assertEqual(reg.place, 1)

        # 2. Invalid override (covers L529-530 exception catch)
        response = self.client.post(
            f"/api/categories/{self.category.pk}/save_results/",
            {"overrides": {"invalid_id": "not_an_int"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_unlock_results(self):
        self._login(self.organizer)
        from apps.tatamis.models import Tatami

        t = Tatami.objects.create(tournament=self.tournament, number=1)
        t.active_results_category = self.category
        t.save()

        self._generate_bracket_setup()
        reg = self.category.registrations.first()
        reg.place = 2
        reg.save()

        response = self.client.post(f"/api/categories/{self.category.pk}/unlock_results/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        reg.refresh_from_db()
        self.assertIsNone(reg.place)

    def test_confirm_weigh_in_validation(self):
        self._login(self.coach)
        ath = Athlete.objects.create(
            first_name="ValidationWeight",
            last_name="AthleteUser",
            coach=self.coach,
            club=self.club_b,
            gender=Athlete.Gender.FEMALE,
            birth_date=date(1999, 12, 31),
            base_weight=62.5,
        )
        reg = Registration.objects.create(
            category=self.category,
            athlete=ath,
            status=Registration.Status.PENDING,
        )

        self._login(self.organizer)
        # Missing weight
        response = self.client.post(
            f"/api/registrations/{reg.pk}/confirm_weigh_in/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid weight format
        response = self.client.post(
            f"/api/registrations/{reg.pk}/confirm_weigh_in/", {"weight": "invalid"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_import_categories_validation(self):
        self._login(self.organizer)
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/import_categories/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/import_categories/",
            {"names": "not_a_list"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Exception during import (covers L228-229 except catch)
        from unittest.mock import patch

        with patch("apps.tournaments.views.parse_category_name") as mock_parse:
            mock_parse.side_effect = ValueError("NLP parsing failed")
            response = self.client.post(
                f"/api/tournaments/{self.tournament.pk}/import_categories/",
                {"names": ["Valid Category"]},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("NLP parsing failed", response.data["detail"])

    def test_import_categories_success(self):
        self._login(self.organizer)
        # Test L213 skipping non-string or empty elements
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/import_categories/",
            {"names": ["", 123]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 0)

        # Success path
        payload = {"names": ["Boys 10-11 -30kg (Karate)"]}
        response = self.client.post(
            f"/api/tournaments/{self.tournament.pk}/import_categories/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 1)

    def test_tournament_retrieve_anonymous_and_authenticated(self):
        # Retrieve anonymously (covers L52-54 AllowAny)
        response = self.client.get(f"/api/tournaments/{self.tournament.pk}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Verify it uses TournamentDetailSerializer (covers L35 return TournamentDetailSerializer)
        self.assertIn("categories", response.data)

        # List anonymously
        response = self.client.get("/api/tournaments/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_tournament_validation_errors(self):
        self._login(self.organizer)
        from unittest.mock import patch

        from django.core.exceptions import ValidationError as DjangoValidationError

        with patch("apps.tournaments.models.Tournament.open_registration") as mock_open:
            mock_open.side_effect = DjangoValidationError("Already open")
            response = self.client.post(f"/api/tournaments/{self.tournament.pk}/open_registration/")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertEqual(response.data["detail"], "Already open")

        with patch("apps.tournaments.models.Tournament.start_tournament") as mock_start:
            mock_start.side_effect = DjangoValidationError("Cannot start")
            response = self.client.post(f"/api/tournaments/{self.tournament.pk}/start/")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertEqual(response.data["detail"], "Cannot start")

        with patch("apps.tournaments.models.Tournament.complete_tournament") as mock_complete:
            mock_complete.side_effect = DjangoValidationError("Cannot complete")
            response = self.client.post(f"/api/tournaments/{self.tournament.pk}/complete/")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertEqual(response.data["detail"], "Cannot complete")

    def test_generate_all_brackets_extra_paths(self):
        self._login(self.organizer)
        cat_with_matches = self.category
        self._create_athlete(1)
        self._create_athlete(2)
        self.client.post(f"/api/categories/{cat_with_matches.pk}/generate_bracket/")
        self.assertTrue(cat_with_matches.matches.exists())

        from apps.tournaments.models import Category

        Category.objects.create(
            tournament=self.tournament,
            name="Cat No Regs",
            allowed_gender="mixed",
            min_age=10,
            max_age=11,
        )

        cat_single = Category.objects.create(
            tournament=self.tournament,
            name="Cat Single",
            allowed_gender="mixed",
            min_age=10,
            max_age=11,
        )
        for i in range(10, 16):
            self._create_athlete(i, category=cat_single)

        from unittest.mock import patch

        from django.core.exceptions import ValidationError as DjangoValidationError

        with patch("apps.brackets.services.BracketGenerator.generate") as mock_gen:
            mock_gen.side_effect = DjangoValidationError("Generator failed")
            response = self.client.post(
                f"/api/tournaments/{self.tournament.pk}/generate_all_brackets/",
                {
                    "round_robin_min": 2,
                    "round_robin_max": 5,
                    "single_elimination_min": 6,
                    "single_elimination_max": 32,
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn("Generator failed", response.data["errors"][0])

    def test_verify_judge_permission_paths(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        judge = User.objects.create_user(
            email="judge_perm@example.com",
            password="password",
            role="judge",
            first_name="Judge",
            last_name="Test",
        )
        self._login(judge)

        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Категорія не призначена на жодне татамі", response.data["detail"])

        from apps.matches.models import Match

        m = Match.objects.create(category=self.category, round_index=0, match_order=1)
        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Категорія не призначена на жодне татамі", response.data["detail"])

        from apps.tatamis.models import Tatami

        tatami = Tatami.objects.create(tournament=self.tournament, number=3, is_active=True)
        m.tatami = tatami
        m.save()
        response = self.client.post(f"/api/categories/{self.category.pk}/save_results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn(
            "Ви не є призначеним суддею на татамі цієї категорії", response.data["detail"]
        )

    def test_registrations_extra_paths(self):
        response = self.client.get(f"/api/registrations/?category={self.category.pk}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.get("/api/registrations/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


@override_settings(MONOBANK_MOCK_PAYMENTS=True)
class CoachDashboardAndBillingIntegrationTest(TestCase):
    """Інтеграційні тести підсистеми білінгу, кастомного персоналу та командних реєстрацій."""

    def setUp(self):
        self.client = APIClient()

        # Clubs
        self.club = Club.objects.create(name="Козаки", region="kyiv_city")

        # Users
        self.organizer = User.objects.create_user(
            email="org_billing@test.local",
            password="testpassword",
            first_name="Олег",
            last_name="Органайзер",
            role=User.Role.ORGANIZER,
            club=self.club,
        )
        self.coach = User.objects.create_user(
            email="coach_billing@test.local",
            password="testpassword",
            first_name="Тарас",
            last_name="Шевченко",
            role=User.Role.COACH,
            club=self.club,
        )
        self.staff = User.objects.create_user(
            email="staff_billing@test.local",
            password="testpassword",
            first_name="Іван",
            last_name="Персонал",
            role=User.Role.STAFF,
            club=self.club,
        )

        # Athlete
        self.athlete1 = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Олексій",
            last_name="Атлет",
            gender=Athlete.Gender.MALE,
            birth_date=date(2005, 1, 1),
            base_weight=74,
            skill_level="КМС",
        )
        self.athlete2 = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Богдан",
            last_name="Атлет",
            gender=Athlete.Gender.MALE,
            birth_date=date(2005, 1, 1),
            base_weight=73,
            skill_level="КМС",
        )

        # Tournaments
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Billing Tournament",
            sport_type="Карате WKF",
            location="Київ",
            start_date=timezone.now() + timedelta(days=5),
            end_date=timezone.now() + timedelta(days=6),
            status=Tournament.Status.REGISTRATION,
            weigh_in_required=True,
            base_registration_fee=1000,
        )
        self.tournament.staff_members.add(self.staff)

        # Categories
        self.ind_category = Category.objects.create(
            tournament=self.tournament,
            name="Male Ind 18-20 -75kg",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=21,
            min_weight=70,
            max_weight=75,
            allowed_skill_level="КМС",
            is_team=False,
        )
        self.team_category = Category.objects.create(
            tournament=self.tournament,
            name="Male Team 18-20",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=21,
            is_team=True,
            allowed_skill_level="КМС",
            registration_fee=800,
        )

    def _login(self, user):
        self.client.force_authenticate(user=user)

    def test_team_crud_and_registration(self):
        # 1. Coach creates a team
        self._login(self.coach)
        response = self.client.post(
            "/api/teams/",
            {
                "name": "Team Golden Lion",
                "club_id": self.club.id,
                "athlete_ids": [self.athlete1.id, self.athlete2.id],
            },
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        team_id = response.data["id"]

        # 2. Coach registers the team to team category
        response = self.client.post(
            "/api/registrations/", {"team_id": team_id, "category": self.team_category.id}
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Verify team fee is multiplied by team size and respects
        # custom registration_fee (800 * 3 = 2400)
        self.assertEqual(response.data["fee"], 2400)

        # Verify it is pending by default since weigh-in is required
        self.assertEqual(response.data["status"], "pending")

        # 3. Check coach cannot register other coaches' teams/athletes (not in setup)
        other_coach = User.objects.create_user(
            email="other_coach@test.local",
            password="testpassword",
            first_name="Other",
            last_name="Coach",
            role=User.Role.COACH,
        )
        self._login(other_coach)
        response = self.client.post(
            "/api/registrations/", {"team_id": team_id, "category": self.team_category.id}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_smart_category_audit_violations(self):
        # Create ineligible athlete (wrong gender)
        female_athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Марія",
            last_name="Атлет",
            gender=Athlete.Gender.FEMALE,
            birth_date=date(2005, 1, 1),
            base_weight=72,
            skill_level="КМС",
        )
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/",
            {"athlete_id": female_athlete.id, "category": self.ind_category.id},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Стать не відповідає категорії", response.data["non_field_errors"][0])

    def test_auto_confirm_and_toggle(self):
        # 1. Register athlete (weigh_in_required=True) -> status should be pending
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/",
            {"athlete_id": self.athlete1.id, "category": self.ind_category.id},
        )
        if response.status_code != status.HTTP_201_CREATED:
            print("AUTO CONFIRM REGISTER ERROR:", response.data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        reg_id = response.data["id"]
        self.assertEqual(response.data["status"], "pending")

        # 2. Toggle weigh-in required to False on tournament
        self._login(self.organizer)
        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/", {"weigh_in_required": False}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # 3. Check registration became confirmed
        reg = Registration.objects.get(id=reg_id)
        self.assertEqual(reg.status, Registration.Status.CONFIRMED)

    def test_bracket_locks(self):
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/",
            {"athlete_id": self.athlete1.id, "category": self.ind_category.id},
        )
        reg_id = response.data["id"]

        # Fake a match to simulate generated bracket
        from apps.matches.models import Match

        Match.objects.create(category=self.ind_category, round_index=1, match_order=1)

        # Try to delete registration -> should fail due to bracket lock
        response = self.client.delete(f"/api/registrations/{reg_id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("сітка змагань уже сформована", response.data["detail"])

    def test_tournament_staff_permissions(self):
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/",
            {"athlete_id": self.athlete1.id, "category": self.ind_category.id},
        )
        reg_id = response.data["id"]

        # Staff logs in and confirms weigh-in
        self._login(self.staff)
        response = self.client.post(
            f"/api/registrations/{reg_id}/confirm_weigh_in/", {"weight": 73.5}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "confirmed")

    def test_bulk_pay_and_offline_fees(self):
        # 1. Register and pay offline
        self._login(self.coach)
        response1 = self.client.post(
            "/api/registrations/",
            {
                "athlete_id": self.athlete1.id,
                "category": self.ind_category.id,
                "payment_method": "offline",
            },
        )
        reg1_id = response1.data["id"]

        # Confirm weigh in so registration is confirmed
        self._login(self.staff)
        self.client.post(f"/api/registrations/{reg1_id}/confirm_weigh_in/", {"weight": 73.5})

        # Bulk pay
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/bulk_pay/",
            {"registration_ids": [reg1_id], "payment_method": "offline"},
            format="json",
        )
        if response.status_code != 200:
            print("BULK PAY ERROR:", response.data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Start and Complete tournament
        self.tournament.status = Tournament.Status.ACTIVE
        self.tournament.save()

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/complete/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify platform fee is 5% of 1000 = 50, status unpaid
        self.tournament.refresh_from_db()
        self.assertEqual(self.tournament.platform_fee_amount, 50)
        self.assertEqual(self.tournament.platform_fee_status, "unpaid")
        # Staff is cleared
        self.assertEqual(self.tournament.staff_members.count(), 0)

        # Try to create new tournament with active debt exceeding credit limit -> should fail
        self.organizer.credit_limit = 0
        self.organizer.save()

        response = self.client.post(
            "/api/tournaments/",
            {
                "title": "Debt Tournament",
                "sport_type": "Карате WKF",
                "location": "Київ",
                "start_date": timezone.now() + timedelta(days=10),
                "end_date": timezone.now() + timedelta(days=11),
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "перевищує встановлений кредитний ліміт", response.data["non_field_errors"][0]
        )

        # Pay platform fee
        response = self.client.post(f"/api/tournaments/{self.tournament.id}/pay_platform_fee/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["platform_fee_status"], "paid")

        # Now creating a tournament should succeed
        response = self.client.post(
            "/api/tournaments/",
            {
                "title": "New Tournament",
                "sport_type": "Карате WKF",
                "location": "Київ",
                "start_date": timezone.now() + timedelta(days=10),
                "end_date": timezone.now() + timedelta(days=11),
            },
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_organizer_included_in_staff_member_me(self):
        # Organizer user
        self._login(self.organizer)
        # Verify staff_members doesn't contain organizer
        self.assertNotIn(self.organizer, self.tournament.staff_members.all())
        # Query tournaments/?staff_member=me
        response = self.client.get("/api/tournaments/?staff_member=me")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should include self.tournament since user is the organizer
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["id"], self.tournament.id)

    def test_base_team_registration_fee_and_ruleset_team_prices(self):
        # 1. Test base team registration fee fallback
        self.tournament.base_team_registration_fee = 700
        self.tournament.save()

        # Create a team category without custom registration_fee
        team_cat_no_override = Category.objects.create(
            tournament=self.tournament,
            name="Male Team No Override",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=21,
            is_team=True,
            ruleset_key="karate_wkf",
        )
        self.assertEqual(team_cat_no_override.get_athlete_fee(), 700)

        # 2. Test ruleset team prices fallback
        self.tournament.ruleset_team_prices = {"karate_wkf": 650}
        self.tournament.save()
        self.assertEqual(team_cat_no_override.get_athlete_fee(), 650)

        # 3. Test custom registration_fee override
        team_cat_no_override.registration_fee = 600
        team_cat_no_override.save()
        self.assertEqual(team_cat_no_override.get_athlete_fee(), 600)

    def test_category_creation_completed_tournament_error(self):
        # Set tournament status to completed
        self.tournament.status = Tournament.Status.COMPLETED
        self.tournament.save()
        self._login(self.organizer)

        payload = {
            "tournament": self.tournament.id,
            "name": "Нова категорія 123",
            "allowed_gender": Category.AllowedGender.MALE,
            "min_age": 18,
            "max_age": 35,
        }
        response = self.client.post("/api/categories/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthorized_user_cannot_create_category(self):
        other_coach = User.objects.create_user(
            email="other_cat_coach@test.local",
            password="testpassword123",  # NOSONAR
            role=User.Role.COACH,
        )
        self._login(other_coach)
        payload = {
            "tournament": self.tournament.id,
            "name": "Нова категорія 123",
            "allowed_gender": Category.AllowedGender.MALE,
            "min_age": 18,
            "max_age": 35,
        }
        response = self.client.post("/api/categories/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_bulk_pay_cross_coach_error(self):
        coach_a = User.objects.create_user(
            email="coach_a@test.local",
            password="testpassword123",  # NOSONAR
            role=User.Role.COACH,
        )
        coach_b = User.objects.create_user(
            email="coach_b@test.local",
            password="testpassword123",  # NOSONAR
            role=User.Role.COACH,
        )
        ath_a = Athlete.objects.create(
            coach=coach_a,
            club=self.club,
            first_name="A",
            last_name="A",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=70,
        )
        ath_b = Athlete.objects.create(
            coach=coach_b,
            club=self.club,
            first_name="B",
            last_name="B",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=70,
        )
        reg_a = Registration.objects.create(
            athlete=ath_a,
            category=self.ind_category,
            status=Registration.Status.PENDING,
        )
        reg_b = Registration.objects.create(
            athlete=ath_b,
            category=self.ind_category,
            status=Registration.Status.PENDING,
        )

        # Coach A tries to pay for both -> 403 Forbidden
        self._login(coach_a)
        payload = {
            "registration_ids": [reg_a.id, reg_b.id],
            "payment_method": "cash",
        }
        response = self.client.post("/api/registrations/bulk_pay/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_registration_extra_scenarios(self):
        # Setup another coach and team for deleting team registration
        other_coach = User.objects.create_user(
            email="other_del_coach@test.local",
            password="testpassword123",  # NOSONAR
            role=User.Role.COACH,
            club=self.club,
        )
        from apps.athletes.models import Team

        other_team = Team.objects.create(
            name="Other Team",
            coach=other_coach,
            club=self.club,
        )
        team_reg = Registration.objects.create(
            team=other_team,
            category=self.ind_category,
            status=Registration.Status.PENDING,
        )

        # 1. Coach list view: query registrations
        # (hits filter Q(athlete__coach=user) | Q(team__coach=user))
        self._login(self.coach)
        response = self.client.get("/api/registrations/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # 2. Try to delete other coach's team registration
        # -> should fail (403 Forbidden via permission class)
        response = self.client.delete(f"/api/registrations/{team_reg.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Create a registration for a completed tournament and try to edit/delete
        completed_tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Completed Tournament Info",
            sport_type="Карате WKF",
            location="Київ",
            start_date=timezone.now() - timedelta(days=10),
            end_date=timezone.now() - timedelta(days=9),
            status=Tournament.Status.COMPLETED,
        )
        completed_category = Category.objects.create(
            tournament=completed_tournament,
            name="Completed Category",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=18,
            max_age=21,
            ruleset_key="karate_wkf",
        )
        completed_reg = Registration.objects.create(
            athlete=self.athlete1,
            category=completed_category,
            status=Registration.Status.CONFIRMED,
        )

        # Organizer logs in
        self._login(self.organizer)

        # Try to edit registration on completed tournament -> should fail
        response = self.client.patch(
            f"/api/registrations/{completed_reg.id}/", {"payment_status": "paid"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Try to delete registration on completed tournament -> should fail
        response = self.client.delete(f"/api/registrations/{completed_reg.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestTournamentStatisticsAndRatings(TournamentAPITestCase):
    """Тести для розширеної статистики турніру та глобальних рейтингів."""

    def test_statistics_endpoints(self):
        # Оновлюємо регіони наших клубів до валідних кодів
        self.club_a.region = "kyiv_city"
        self.club_a.save()
        self.club_b.region = "lviv"
        self.club_b.save()

        # Створюємо атлетів та реєстрації
        ath1, reg1 = self._create_athlete(1, self.club_a)
        ath2, reg2 = self._create_athlete(2, self.club_b)
        ath3, reg3 = self._create_athlete(3, self.club_a)

        # Призначаємо призові місця
        reg1.place = 1  # Золото
        reg1.save()
        reg2.place = 2  # Срібло
        reg2.save()
        reg3.place = 3  # Бронза
        reg3.save()

        # Створюємо completed матч для перевірки статистики поєдинків
        from apps.matches.models import Match

        Match.objects.create(
            category=self.category,
            round_index=1,
            match_order=1,
            reg_first=reg1,
            reg_second=reg2,
            winner=reg1,
            win_method="decision",
            status=Match.Status.COMPLETED,
            timer_elapsed_ms=120000,
        )

        # 1. Запит статистики конкретного турніру
        response = self.client.get(f"/api/tournaments/{self.tournament.id}/statistics/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.data
        self.assertIn("club_standings", data)
        self.assertIn("region_standings", data)
        self.assertIn("general_stats", data)
        self.assertIn("match_stats", data)

        # Перевірка заліку (Клуб А: 1 золото, 1 бронза = 10б; Клуб Б: 1 срібло = 5б)
        club_standings = data["club_standings"]
        self.assertEqual(len(club_standings), 2)
        # Клуб А має бути першим (більше золота)
        self.assertEqual(club_standings[0]["club_id"], self.club_a.id)
        self.assertEqual(club_standings[0]["gold"], 1)
        self.assertEqual(club_standings[0]["bronze"], 1)
        self.assertEqual(club_standings[0]["points"], 10)
        self.assertEqual(club_standings[0]["athletes_count"], 2)

        # Клуб Б другим
        self.assertEqual(club_standings[1]["club_id"], self.club_b.id)
        self.assertEqual(club_standings[1]["silver"], 1)
        self.assertEqual(club_standings[1]["points"], 5)
        self.assertEqual(club_standings[1]["athletes_count"], 1)

        # Перевірка заліку областей
        region_standings = data["region_standings"]
        self.assertEqual(len(region_standings), 27)
        self.assertEqual(region_standings[0]["region_code"], "kyiv_city")
        self.assertEqual(region_standings[0]["gold"], 1)
        self.assertEqual(region_standings[1]["region_code"], "lviv")
        self.assertEqual(region_standings[1]["silver"], 1)

        # Перевірка загальної статистики
        gen_stats = data["general_stats"]
        self.assertEqual(gen_stats["total_athletes"], 3)
        self.assertEqual(gen_stats["total_clubs"], 2)
        self.assertEqual(gen_stats["total_regions"], 2)

        # Перевірка статистики матчів
        match_stats = data["match_stats"]
        self.assertEqual(match_stats["completed_matches"], 1)
        self.assertEqual(match_stats["average_duration_seconds"], 120)
        self.assertEqual(len(match_stats["win_methods"]), 1)
        self.assertEqual(match_stats["win_methods"][0]["method"], "decision")

        # 2. Перевірка глобальних рейтингів
        response = self.client.get("/api/tournaments/global-ratings/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        global_data = response.data
        self.assertIn("club_ratings", global_data)
        self.assertIn("region_ratings", global_data)

        # Перевіряємо глобальні бали
        club_ratings = global_data["club_ratings"]
        self.assertEqual(club_ratings[0]["club_id"], self.club_a.id)
        self.assertEqual(club_ratings[0]["points"], 10)
        self.assertEqual(club_ratings[0]["tournaments_count"], 1)

        region_ratings = global_data["region_ratings"]
        self.assertEqual(len(region_ratings), 27)
        self.assertEqual(region_ratings[0]["region_code"], "kyiv_city")
        self.assertEqual(region_ratings[0]["points"], 10)


class TournamentDashboardEnhancementsTestCase(TestCase):
    """Тести для покращень панелей тренера та секретаря."""

    def setUp(self):
        self.client = APIClient()
        import uuid

        test_pass = str(uuid.uuid4())
        self.organizer = User.objects.create_user(
            email="organizer@test.local",
            password=test_pass,
            first_name="Орг",
            last_name="Турнірний",
            role=User.Role.ORGANIZER,
        )
        self.coach = User.objects.create_user(
            email="coach@test.local",
            password=test_pass,
            first_name="Тренер",
            last_name="Клубовий",
            role=User.Role.COACH,
        )
        self.club = Club.objects.create(name="Тест Клуб")
        self.coach.club = self.club
        self.coach.is_club_leader = True
        self.coach.save()

        # Tournament with weigh-in required
        self.tournament = Tournament.objects.create(
            organizer=self.organizer,
            title="Турнір зі зважуванням",
            sport_type="Карате",
            location="Київ",
            start_date=timezone.now() + timezone.timedelta(days=2),
            end_date=timezone.now() + timezone.timedelta(days=3),
            registration_start=timezone.now() - timezone.timedelta(days=1),
            registration_end=timezone.now() + timezone.timedelta(days=1),
            weigh_in_required=True,
        )
        self.category = Category.objects.create(
            tournament=self.tournament,
            name="Хлопці 10-11 років, -35 кг",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=10,
            max_age=11,
            min_weight=30.0,
            max_weight=35.0,
        )
        self.category_open = Category.objects.create(
            tournament=self.tournament,
            name="Хлопці 10-11 років, Абсолютна",
            allowed_gender=Category.AllowedGender.MALE,
            min_age=10,
            max_age=11,
        )
        self.athlete = Athlete.objects.create(
            coach=self.coach,
            club=self.club,
            first_name="Іван",
            last_name="Іванов",
            gender="male",
            birth_date=date(2015, 5, 5),
            base_weight=33.0,
        )
        self.reg1 = Registration.objects.create(
            athlete=self.athlete,
            category=self.category,
            status=Registration.Status.PENDING,
        )
        self.reg2 = Registration.objects.create(
            athlete=self.athlete,
            category=self.category_open,
            status=Registration.Status.PENDING,
        )

    def _login(self, user):
        self.client.force_authenticate(user=user)

    def test_athlete_weigh_in_success(self):
        """Успішне зважування спортсмена для всіх категорій."""
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/athlete_weigh_in/",
            {
                "athlete_id": self.athlete.id,
                "tournament_id": self.tournament.id,
                "weight": 32.5,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Перевіряємо, що обидві реєстрації отримали вагу і статус confirmed
        self.reg1.refresh_from_db()
        self.reg2.refresh_from_db()
        self.assertEqual(float(self.reg1.recorded_weight), 32.5)
        self.assertEqual(self.reg1.status, Registration.Status.CONFIRMED)
        self.assertEqual(float(self.reg2.recorded_weight), 32.5)
        self.assertEqual(self.reg2.status, Registration.Status.CONFIRMED)

    def test_athlete_weigh_in_validation_error(self):
        """Помилка зважування, якщо вага виходить за межі категорії."""
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/athlete_weigh_in/",
            {
                "athlete_id": self.athlete.id,
                "tournament_id": self.tournament.id,
                "weight": 38.0,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("більша за максимально допустиму", response.data["detail"])

        # Перевіряємо, що нічого не змінилося
        self.reg1.refresh_from_db()
        self.assertEqual(self.reg1.status, Registration.Status.PENDING)

    def test_athlete_weigh_in_disabled(self):
        """Помилка при спробі зважування, якщо зважування вимкнено для турніру."""
        self.tournament.weigh_in_required = False
        self.tournament.save()

        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/athlete_weigh_in/",
            {
                "athlete_id": self.athlete.id,
                "tournament_id": self.tournament.id,
                "weight": 32.5,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["detail"], "Зважування не потрібне для цього турніру.")

    def test_auto_transition_statuses(self):
        """Автоматична зміна статусів турніру по датах."""
        t_draft = Tournament.objects.create(
            organizer=self.organizer,
            title="Чернетка статусів",
            sport_type="Карате",
            location="Київ",
            start_date=timezone.now() + timezone.timedelta(days=2),
            end_date=timezone.now() + timezone.timedelta(days=3),
            registration_start=timezone.now() - timezone.timedelta(hours=1),
            registration_end=timezone.now() + timezone.timedelta(days=1),
            status=Tournament.Status.DRAFT,
        )

        response = self.client.get(f"/api/tournaments/{t_draft.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Має автоматично змінити статус на registration
        t_draft.refresh_from_db()
        self.assertEqual(t_draft.status, Tournament.Status.REGISTRATION)

        t_reg = Tournament.objects.create(
            organizer=self.organizer,
            title="Реєстрація статусів",
            sport_type="Карате",
            location="Київ",
            start_date=timezone.now() - timezone.timedelta(hours=1),
            end_date=timezone.now() + timezone.timedelta(hours=5),
            status=Tournament.Status.REGISTRATION,
        )

        response = self.client.get(f"/api/tournaments/{t_reg.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        t_reg.refresh_from_db()
        self.assertEqual(t_reg.status, Tournament.Status.ACTIVE)

    def test_bulk_withdraw_coach_restricted(self):
        """
        Зняття через bulk_withdraw дозволено під час реєстрації,
        але заблоковано для тренера після старту.
        """
        self.tournament.status = Tournament.Status.REGISTRATION
        self.tournament.save()

        # Coach bulk withdraws reg1 and reg2
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/bulk_withdraw/",
            {"registration_ids": [self.reg1.id, self.reg2.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Regs should be deleted because they are unpaid
        self.assertFalse(Registration.objects.filter(id__in=[self.reg1.id, self.reg2.id]).exists())

        # Re-create registrations
        self.reg1 = Registration.objects.create(
            athlete=self.athlete, category=self.category, status=Registration.Status.PENDING
        )
        self.reg2 = Registration.objects.create(
            athlete=self.athlete, category=self.category_open, status=Registration.Status.PENDING
        )

        # Move tournament to active
        self.tournament.status = Tournament.Status.ACTIVE
        self.tournament.save()

        # Coach tries to withdraw now - should be blocked
        response = self.client.post(
            "/api/registrations/bulk_withdraw/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Тренер не може знімати", response.data["detail"])

    def test_bulk_withdraw_unpaid_delete_vs_withdraw(self):
        """Несплачені заявки видаляються для тренера, але стають 'withdrawn' для секретаря."""
        self.tournament.status = Tournament.Status.REGISTRATION
        self.tournament.save()

        # Secretary bulk withdraws reg1 (unpaid)
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/bulk_withdraw/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Since it was done by organizer/secretary, it is NOT deleted,
        # but status is set to withdrawn
        self.reg1.refresh_from_db()
        self.assertEqual(self.reg1.status, Registration.Status.WITHDRAWN)

    def test_deferred_refunds_on_completion(self):
        """
        Під час активного турніру зняття не запускає рефаунд відразу,
        а відкладає його до завершення турніру.
        """
        from apps.billing.models import PaymentInvoice, Transaction

        self.tournament.status = Tournament.Status.ACTIVE
        self.tournament.save()

        # Mark reg1 as paid online
        self.reg1.payment_status = "paid"
        self.reg1.payment_method = "online"
        self.reg1.save()

        # Create paid PaymentInvoice and link to reg1
        invoice = PaymentInvoice.objects.create(
            user=self.coach,
            amount=500,
            status=PaymentInvoice.Status.PAID,
            invoice_id="mock-inv-123",
            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
        )
        invoice.registrations.add(self.reg1)

        # Create paid transaction
        Transaction.objects.create(
            invoice=invoice,
            user=self.coach,
            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
            transaction_type=Transaction.Type.PAYMENT,
            amount=500,
            method=Transaction.Method.ONLINE,
            reference="TX-123",
        )

        # Secretary withdraws reg1 during ACTIVE tournament
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/bulk_withdraw/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Refund should be DEFERRED: registration status is withdrawn,
        # but payment_status remains paid!
        self.reg1.refresh_from_db()
        self.assertEqual(self.reg1.status, Registration.Status.WITHDRAWN)
        self.assertEqual(self.reg1.payment_status, "paid")

        # No refund transactions should exist yet
        self.assertFalse(
            Transaction.objects.filter(transaction_type=Transaction.Type.REFUND).exists()
        )

        # Complete tournament
        response = self.client.post(f"/api/tournaments/{self.tournament.id}/complete/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Now refund should be processed: payment_status is unpaid,
        # and REFUND Transaction is created!
        self.reg1.refresh_from_db()
        self.assertEqual(self.reg1.payment_status, "unpaid")

        refund_tx = Transaction.objects.filter(transaction_type=Transaction.Type.REFUND).first()
        self.assertIsNotNone(refund_tx)
        self.assertEqual(refund_tx.invoice, invoice)
        self.assertEqual(refund_tx.amount, -500)

    def test_bulk_offline_refund_flow(self):
        # Setup an offline paid registration
        self.reg1.payment_method = "offline"
        self.reg1.payment_status = "paid"
        self.reg1.status = Registration.Status.WITHDRAWN
        self.reg1.offline_refund_status = "none"
        self.reg1.save()

        self.reg2.payment_method = "offline"
        self.reg2.payment_status = "paid"
        self.reg2.status = Registration.Status.WITHDRAWN
        self.reg2.offline_refund_status = "none"
        self.reg2.save()

        # 1. Anonymous / Non-auth cannot access
        self.client.force_authenticate(user=None)
        response = self.client.post(
            "/api/registrations/bulk_mark_offline_refunded/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # 2. Coach cannot mark offline refunded (needs to be organizer, staff or admin)
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/bulk_mark_offline_refunded/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Organizer marks offline refunded successfully -> status becomes PENDING
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/bulk_mark_offline_refunded/",
            {"registration_ids": [self.reg1.id, self.reg2.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.reg1.refresh_from_db()
        self.reg2.refresh_from_db()
        self.assertEqual(self.reg1.offline_refund_status, "pending")
        self.assertEqual(self.reg2.offline_refund_status, "pending")

        # 4. Coach confirms refund -> status is CONFIRMED, payment is UNPAID
        self._login(self.coach)
        response = self.client.post(
            "/api/registrations/bulk_confirm_offline_refund_received/",
            {"registration_ids": [self.reg1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.reg1.refresh_from_db()
        self.assertEqual(self.reg1.offline_refund_status, "confirmed")
        self.assertEqual(self.reg1.payment_status, "unpaid")

        # 5. Organizer confirms receipt of refund -> status becomes CONFIRMED
        self._login(self.organizer)
        response = self.client.post(
            "/api/registrations/bulk_confirm_offline_refund_received/",
            {"registration_ids": [self.reg2.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.reg2.refresh_from_db()
        self.assertEqual(self.reg2.offline_refund_status, "confirmed")
        self.assertEqual(self.reg2.payment_status, "unpaid")

        # 6. Invalid registration_ids format
        response = self.client.post(
            "/api/registrations/bulk_mark_offline_refunded/",
            {"registration_ids": "invalid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 7. Non-existent registrations
        response = self.client.post(
            "/api/registrations/bulk_mark_offline_refunded/",
            {"registration_ids": [99999]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestTournamentChiefJudgePermissions(TournamentAPITestCase):
    """Тести для перевірки прав головного судді (Chief Judge)."""

    def setUp(self):
        super().setUp()
        # Призначаємо головного суддю
        self.tournament.chief_judge = self.judge
        self.tournament.save()

    def test_chief_judge_can_generate_and_delete_bracket(self):
        """Головний суддя може генерувати та видаляти сітку для категорій свого турніру."""
        self._login(self.judge)

        # Створимо принаймні 2 учасників для генерації
        self._create_athlete(1)
        self._create_athlete(2)

        # Генерація сітки
        response = self.client.post(f"/api/categories/{self.category.pk}/generate_bracket/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Видалення сітки
        response = self.client.post(f"/api/categories/{self.category.pk}/delete_bracket/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_chief_judge_can_manage_tatami_assignments(self):
        """Головний суддя може призначати категорії на татамі."""
        self._login(self.judge)

        # Створюємо татамі для турніру
        from apps.tatamis.models import Tatami

        tatami = Tatami.objects.create(
            tournament=self.tournament, number=1, name="Tatami 1", is_active=True
        )

        response = self.client.post(
            f"/api/categories/{self.category.pk}/assign_tatami/",
            {"tatami_id": tatami.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_chief_judge_cannot_modify_critical_tournament_fields(self):
        """Головний суддя не може змінювати дати проведення чи статус турніру."""
        self._login(self.judge)

        payload = {
            "title": "Зміна назви головним суддею",
            "start_date": (timezone.now() + timedelta(days=5)).isoformat(),
        }

        # Редагування турніру через PATCH
        url = f"/api/tournaments/{self.tournament.pk}/"
        response = self.client.patch(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_chief_judge_cannot_delete_registrations(self):
        """Головний суддя не може видаляти реєстрації спортсменів."""
        self._create_athlete(1)
        registration = Registration.objects.first()

        self._login(self.judge)
        response = self.client.delete(f"/api/registrations/{registration.pk}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_chief_judge_must_be_in_judges_list_validation(self):
        """Валідація не дозволяє встановити головного суддю,
        якщо він не входить до списку суддів турніру.
        """
        self._login(self.organizer)

        # Скинемо спочатку chief_judge, щоб перевірити оновлення
        self.tournament.chief_judge = None
        self.tournament.save()

        payload = {"chief_judge": self.judge.id, "judges": []}
        url = f"/api/tournaments/{self.tournament.pk}/"
        response = self.client.patch(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("chief_judge", response.data)

    def test_chief_judge_successfully_set(self):
        """Організатор може успішно встановити головного суддю,
        якщо він доданий до списку суддів турніру.
        """
        self._login(self.organizer)

        # Скинемо спочатку chief_judge та очистимо judges
        self.tournament.chief_judge = None
        self.tournament.judges.clear()
        self.tournament.save()

        payload = {"chief_judge": self.judge.id, "judges": [self.judge.id]}
        url = f"/api/tournaments/{self.tournament.pk}/"
        response = self.client.patch(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tournament.refresh_from_db()
        self.assertEqual(self.tournament.chief_judge_id, self.judge.id)
        self.assertTrue(self.tournament.judges.filter(id=self.judge.id).exists())


class TestRegistrationFiltersAndSearch(TournamentAPITestCase):
    """Тести для фільтрації, пошуку та сортування реєстрацій (учасників)."""

    def setUp(self):
        super().setUp()
        self.club_c = Club.objects.create(name="Альфа Клуб", region="Одеса")
        self.club_d = Club.objects.create(name="Бета Клуб", region="Харків")

        # Створимо кілька атлетів з різними параметрами
        # Атлет 1: Альфа Клуб, Male, weight 70
        self.athlete1 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_c,
            first_name="Олексій",
            last_name="Борисов",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=70,
        )
        self.reg1 = Registration.objects.create(
            athlete=self.athlete1,
            category=self.category,
            status=Registration.Status.CONFIRMED,
        )

        # Атлет 2: Бета Клуб, Male, weight 74
        self.athlete2 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_d,
            first_name="Дмитро",
            last_name="Петров",
            gender=Athlete.Gender.MALE,
            birth_date=date(2000, 1, 1),
            base_weight=74,
        )
        self.reg2 = Registration.objects.create(
            athlete=self.athlete2,
            category=self.category,
            status=Registration.Status.CONFIRMED,
        )

        # Атлет 3: Альфа Клуб, Female, weight 65 (у іншій категорії)
        self.category_female = Category.objects.create(
            name="Жінки -65кг",
            tournament=self.tournament,
            allowed_gender=Category.AllowedGender.FEMALE,
            min_age=18,
            max_age=35,
            min_weight=60,
            max_weight=65,
        )
        self.athlete3 = Athlete.objects.create(
            coach=self.coach,
            club=self.club_c,
            first_name="Марія",
            last_name="Антонова",
            gender=Athlete.Gender.FEMALE,
            birth_date=date(2000, 1, 1),
            base_weight=65,
        )
        self.reg3 = Registration.objects.create(
            athlete=self.athlete3,
            category=self.category_female,
            status=Registration.Status.CONFIRMED,
        )

    def test_filter_by_category(self):
        """Перевірка фільтрації реєстрацій за категорією."""
        self._login(self.organizer)
        response = self.client.get(f"/api/registrations/?category={self.category_female.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Має бути тільки reg3
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], self.reg3.id)

    def test_filter_by_club(self):
        """Перевірка фільтрації реєстрацій за клубом спортсмена."""
        self._login(self.organizer)
        response = self.client.get(f"/api/registrations/?athlete__club={self.club_c.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        # Очікуємо reg1 та reg3 (обидва з Альфа Клуб)
        self.assertEqual(len(results), 2)
        reg_ids = [r["id"] for r in results]
        self.assertIn(self.reg1.id, reg_ids)
        self.assertIn(self.reg3.id, reg_ids)

    def test_filter_by_gender(self):
        """Перевірка фільтрації реєстрацій за статтю."""
        self._login(self.organizer)
        response = self.client.get("/api/registrations/?athlete__gender=female")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        # Очікуємо лише reg3 (female)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], self.reg3.id)

    def test_search_registrations(self):
        """Перевірка пошуку за ім'ям, прізвищем або назвою клубу."""
        self._login(self.organizer)

        # Пошук за прізвищем "Петров"
        response = self.client.get("/api/registrations/?search=Петров")
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], self.reg2.id)

        # Пошук за назвою клубу "Альфа"
        response = self.client.get("/api/registrations/?search=Альфа")
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 2)

    def test_ordering_registrations(self):
        """Перевірка сортування реєстрацій."""
        self._login(self.organizer)

        # Сортування за вагою спортсмена (через remapped athlete__weight параметр)
        response = self.client.get("/api/registrations/?ordering=athlete__weight")
        results = response.data.get("results", response.data)
        # Очікувана черга ваг: 65, 70, 74 (reg3, reg1, reg2)
        self.assertEqual(results[0]["id"], self.reg3.id)
        self.assertEqual(results[1]["id"], self.reg1.id)
        self.assertEqual(results[2]["id"], self.reg2.id)

        # Зворотне сортування за прізвищем
        response = self.client.get("/api/registrations/?ordering=-athlete__last_name")
        results = response.data.get("results", response.data)
        # Антонова (А), Борисов (Б), Петров (П)
        # -> Зворотне: Петров (reg2), Борисов (reg1), Антонова (reg3)
        self.assertEqual(results[0]["id"], self.reg2.id)
        self.assertEqual(results[1]["id"], self.reg1.id)
        self.assertEqual(results[2]["id"], self.reg3.id)
