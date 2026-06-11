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
