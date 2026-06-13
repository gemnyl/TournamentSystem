"""Тести створення спортсменів із перевіркою автоматичного визначення клубу."""

import io

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete, AthleteWeightLog


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

    def test_organizer_cannot_create_athlete(self):
        """Організатор не може створити атлета (403)."""
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
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_log_weight(self):
        """Тест мануального додавання заміру ваги спортсмена тренером."""
        athlete = Athlete.objects.create(
            first_name="Іван",
            last_name="Іванов",
            gender="male",
            birth_date="2010-05-15",
            base_weight=55.0,
            coach=self.coach_with_club,
            club=self.club,
        )

        self.client.force_authenticate(user=self.coach_with_club)
        payload = {"weight": 58.5, "notes": "Замір перед тренуванням"}
        response = self.client.post(
            f"/api/athletes/{athlete.id}/log_weight/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["weight"], 58.5)
        self.assertEqual(response.data["notes"], "Замір перед тренуванням")

        # Перевіряємо оновлення базової ваги спортсмена
        athlete.refresh_from_db()
        self.assertEqual(float(athlete.base_weight), 58.5)

        # Перевіряємо створення запису в лозі
        self.assertTrue(AthleteWeightLog.objects.filter(athlete=athlete, weight=58.5).exists())

    def test_import_athletes_csv(self):
        """Тест успішного імпорту спортсменів з CSV файлу."""
        self.client.force_authenticate(user=self.coach_with_club)
        csv_content = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,Іван,Васильович,Ч,2010-05-15,55.0,1 кю\n"
            "Сидорова,Ольга,Миколаївна,Ж,2012-08-20,40.5,2 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["imported_count"], 2)

        # Перевіряємо чи додались в БД
        self.assertEqual(Athlete.objects.filter(coach=self.coach_with_club).count(), 2)
        athlete = Athlete.objects.get(last_name="Іванов")
        self.assertEqual(athlete.first_name, "Іван")
        self.assertEqual(athlete.gender, "male")
        self.assertEqual(float(athlete.base_weight), 55.0)

    def test_import_athletes_excel(self):
        """Тест успішного імпорту спортсменів з Excel файлу (.xlsx)."""
        self.client.force_authenticate(user=self.coach_with_club)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Прізвище", "Ім'я", "По батькові", "Стать", "Дата народження", "Вага", "Розряд"])
        ws.append(["Петренко", "Петро", "Олегович", "Ч", "2011-06-10", "48.2", "3 кю"])
        ws.append(["Шевченко", "Марія", "", "Ж", "2013-09-12", "35.0", "4 кю"])

        file_stream = io.BytesIO()
        wb.save(file_stream)
        file_stream.seek(0)

        uploaded_file = SimpleUploadedFile(
            "athletes.xlsx",
            file_stream.read(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["imported_count"], 2)
        self.assertEqual(Athlete.objects.filter(coach=self.coach_with_club).count(), 2)

    def test_import_athletes_validation_error_rollback(self):
        """Тест відкоту всієї транзакції (атомарність) при наявності помилок у файлі."""
        self.client.force_authenticate(user=self.coach_with_club)
        csv_content = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,Іван,Васильович,Ч,2010-05-15,55.0,1 кю\n"
            "Сидорова,Ольга,Миколаївна,НЕКОРЕКТНА_СТАТЬ,2012-08-20,40.5,2 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertTrue(len(response.data["errors"]) > 0)

        # Перевіряємо, що в БД НЕ було додано жодного спортсмена
        self.assertEqual(Athlete.objects.filter(coach=self.coach_with_club).count(), 0)

    def test_athlete_list_ordering(self):
        """Тест фільтрації та сортування спортсменів."""
        # Створюємо додаткових спортсменів для перевірки сортування
        Athlete.objects.create(
            first_name="Олексій",
            last_name="Алексєєв",
            gender="male",
            birth_date="2010-05-15",
            base_weight=55.0,
            coach=self.coach_with_club,
            club=self.club,
        )
        Athlete.objects.create(
            first_name="Борис",
            last_name="Борисов",
            gender="male",
            birth_date="2011-06-20",
            base_weight=60.0,
            coach=self.coach_with_club,
            club=self.club,
        )

        self.client.force_authenticate(user=self.coach_with_club)

        # Сортування за прізвищем за зростанням
        response = self.client.get("/api/athletes/?ordering=last_name")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # У відповіді може бути пагінація
        results = response.data.get("results", response.data)
        last_names = [x["last_name"] for x in results]
        self.assertEqual(last_names, ["Алексєєв", "Борисов"])

        # Сортування за прізвищем за спаданням
        response = self.client.get("/api/athletes/?ordering=-last_name")
        results = response.data.get("results", response.data)
        last_names = [x["last_name"] for x in results]
        self.assertEqual(last_names, ["Борисов", "Алексєєв"])

        # Сортування за ім'ям за зростанням
        response = self.client.get("/api/athletes/?ordering=first_name")
        results = response.data.get("results", response.data)
        first_names = [x["first_name"] for x in results]
        self.assertEqual(first_names, ["Борис", "Олексій"])

        # Сортування за ім'ям за спаданням
        response = self.client.get("/api/athletes/?ordering=-first_name")
        results = response.data.get("results", response.data)
        first_names = [x["first_name"] for x in results]
        self.assertEqual(first_names, ["Олексій", "Борис"])

        # Сортування за іншими полями (birth_date, base_weight)
        response = self.client.get("/api/athletes/?ordering=birth_date")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.get("/api/athletes/?ordering=-base_weight")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_spectator_permissions_read_only(self):
        """
        Глядач чи неавтентифікований користувач не може створювати/редагувати атлетів,
        але авторизований глядач може читати.
        """
        # Без авторизації читання заборонено
        response = self.client.get("/api/athletes/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Створення без авторизації заборонено
        response = self.client.post("/api/athletes/", {"first_name": "Тест"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Авторизований глядач може читати
        spectator = User.objects.create_user(
            email="spectator@test.local",
            password="testpassword123",
            first_name="Глядач",
            last_name="Тест",
            role=User.Role.SPECTATOR,
        )
        self.client.force_authenticate(user=spectator)
        response = self.client.get("/api/athletes/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Авторизований глядач не може створювати
        response = self.client.post("/api/athletes/", {"first_name": "Тест"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_log_weight_validation_errors(self):
        """Тест помилок валідації при додаванні заміру ваги."""
        athlete = Athlete.objects.create(
            first_name="Іван",
            last_name="Іванов",
            gender="male",
            birth_date="2010-05-15",
            base_weight=55.0,
            coach=self.coach_with_club,
            club=self.club,
        )

        # Інший тренер намагається додати вагу -> 404 Not Found
        # (оскільки спортсмен відфільтрований з get_queryset)
        other_coach = User.objects.create_user(
            email="other_coach@test.local",
            password="testpassword123",
            first_name="Інший",
            last_name="Тренер",
            role=User.Role.COACH,
        )
        self.client.force_authenticate(user=other_coach)
        payload = {"weight": 58.5}
        response = self.client.post(
            f"/api/athletes/{athlete.id}/log_weight/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        # Свій тренер надсилає порожній запит -> 400
        self.client.force_authenticate(user=self.coach_with_club)
        response = self.client.post(f"/api/athletes/{athlete.id}/log_weight/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Свій тренер надсилає некоректний формат ваги -> 400
        response = self.client.post(
            f"/api/athletes/{athlete.id}/log_weight/", {"weight": "invalid-weight"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_weight_history_api(self):
        """Тест отримання історії ваги атлета."""
        athlete = Athlete.objects.create(
            first_name="Іван",
            last_name="Іванов",
            gender="male",
            birth_date="2010-05-15",
            base_weight=55.0,
            coach=self.coach_with_club,
            club=self.club,
        )
        # Створення початкового логу відбувається автоматично при збереженні (is_new)
        self.client.force_authenticate(user=self.coach_with_club)
        response = self.client.get(f"/api/athletes/{athlete.id}/weight_history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["weight"], 55.0)

    def test_import_athletes_validation_cases(self):
        """Тести різноманітних помилок валідації при імпорті атлетів."""
        self.client.force_authenticate(user=self.coach_with_club)

        # 1. Файл не надано
        response = self.client.post("/api/athletes/import_athletes/", {}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Непідтримуваний формат
        uploaded_file = SimpleUploadedFile(
            "athletes.txt", b"plain text content", content_type="text/plain"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Порожній CSV файл
        uploaded_file = SimpleUploadedFile("athletes.csv", b"", content_type="text/csv")
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. Коуч без клубу
        self.client.force_authenticate(user=self.coach_no_club)
        csv_content = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,Іван,Васильович,Ч,2010-05-15,55.0,1 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 5. Відсутні обов'язкові колонки
        self.client.force_authenticate(user=self.coach_with_club)
        csv_content_missing_cols = "Прізвище,Ім'я,Стать\nІванов,Іван,Ч\n"
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content_missing_cols.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 6. Рядок з пустим ім'ям
        csv_content_empty_name = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,,Васильович,Ч,2010-05-15,55.0,1 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content_empty_name.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 7. Рядок з некоректною датою
        csv_content_invalid_date = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,Іван,Васильович,Ч,некоректна-дата,55.0,1 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content_invalid_date.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # 8. Рядок з некоректною вагою
        csv_content_invalid_weight = (
            "Прізвище,Ім'я,По батькові,Стать,Дата народження,Вага,Розряд\n"
            "Іванов,Іван,Васильович,Ч,2010-05-15,вага,1 кю\n"
        )
        uploaded_file = SimpleUploadedFile(
            "athletes.csv", csv_content_invalid_weight.encode("utf-8"), content_type="text/csv"
        )
        response = self.client.post(
            "/api/athletes/import_athletes/", {"file": uploaded_file}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_team_viewset_crud_and_permissions(self):
        """Тест CRUD операцій для команд (TeamViewSet) та прав доступу."""
        # 1. Тренер створює команду
        self.client.force_authenticate(user=self.coach_with_club)
        athlete = Athlete.objects.create(
            first_name="Іван",
            last_name="Іванов",
            gender="male",
            birth_date="2010-05-15",
            base_weight=55.0,
            coach=self.coach_with_club,
            club=self.club,
        )

        payload = {"name": "Тестова Команда", "club_id": self.club.id, "athlete_ids": [athlete.id]}
        from apps.athletes.models import Team

        response = self.client.post("/api/teams/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        team_id = response.data["id"]

        # 2. Тренер отримує список своїх команд
        response = self.client.get("/api/teams/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Перевіряємо пагінацію
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Тестова Команда")

        # 3. Інший тренер створює свою команду
        other_coach = User.objects.create_user(
            email="other_team_coach@test.local",
            password="testpassword123",
            first_name="Інший",
            last_name="Тренер",
            role=User.Role.COACH,
            club=self.club,
        )
        self.client.force_authenticate(user=other_coach)
        # Для other_coach список команд має бути пустим (фільтр get_queryset)
        response = self.client.get("/api/teams/")
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 0)

        # 4. Видалення команди
        self.client.force_authenticate(user=self.coach_with_club)
        response = self.client.delete(f"/api/teams/{team_id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Team.objects.filter(id=team_id).exists())
