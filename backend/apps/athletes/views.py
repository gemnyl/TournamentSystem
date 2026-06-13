from django.db.models.functions import Lower
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.athletes.models import Athlete, AthleteWeightLog, Team
from apps.athletes.serializers import AthleteSerializer, TeamSerializer


class CaseInsensitiveOrderingFilter(filters.OrderingFilter):
    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if ordering:
            new_ordering = []
            for field in ordering:
                descending = field.startswith("-")
                clean_field = field[1:] if descending else field

                if clean_field == "last_name":
                    if descending:
                        new_ordering.extend([Lower("last_name").desc(), Lower("first_name").desc()])
                    else:
                        new_ordering.extend([Lower("last_name").asc(), Lower("first_name").asc()])
                elif clean_field == "first_name":
                    if descending:
                        new_ordering.extend([Lower("first_name").desc(), Lower("last_name").desc()])
                    else:
                        new_ordering.extend([Lower("first_name").asc(), Lower("last_name").asc()])
                elif clean_field in ["birth_date", "base_weight"]:
                    new_ordering.append(field)
                else:
                    new_ordering.append(field)
            return queryset.order_by(*new_ordering)
        return queryset


class AthleteViewSet(viewsets.ModelViewSet):
    """CRUD спортсменів з автоматичним фільтром за роллю тренера."""

    serializer_class = AthleteSerializer
    from apps.common.pagination import OptionalPageNumberPagination

    pagination_class = OptionalPageNumberPagination

    filter_backends = [filters.SearchFilter, CaseInsensitiveOrderingFilter]
    search_fields = ["first_name", "last_name", "patronymic"]
    ordering_fields = ["first_name", "last_name", "birth_date", "base_weight"]
    ordering = ["last_name", "first_name"]

    def get_queryset(self):
        user = self.request.user
        qs = Athlete.objects.select_related("club", "coach").all()
        # Тренер бачить лише своїх
        if user.role == "coach":
            qs = qs.filter(coach=user)
        return qs

    def get_permissions(self):
        # Запис — тренери, організатори та адміни
        if self.action in (
            "create",
            "update",
            "partial_update",
            "destroy",
            "log_weight",
            "import_athletes",
        ):
            from rest_framework.permissions import BasePermission

            class IsCoachOrAdmin(BasePermission):
                def has_permission(self, request, view):
                    return bool(
                        request.user
                        and request.user.is_authenticated
                        and request.user.role in ("coach", "admin")
                    )

            return [IsCoachOrAdmin()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        user = self.request.user
        club = serializer.validated_data.get("club")

        # Якщо клуб не передано, а користувач є тренером із призначеним клубом, використовуємо його
        if not club and user.role == "coach" and hasattr(user, "club") and user.club:
            club = user.club
            serializer.validated_data["club"] = club

        # Якщо після цього клуб все ще не визначено, повертаємо помилку валідації
        if not serializer.validated_data.get("club"):
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"club_id": "Вкажіть клуб або призначте клуб тренеру."})

        serializer.save()

    @action(detail=True, methods=["get"], url_path="weight_history")
    def weight_history(self, request, pk=None):
        athlete = self.get_object()
        logs = athlete.weight_logs.all().order_by("logged_at")
        data = [
            {
                "id": log.id,
                "weight": float(log.weight),
                "logged_at": log.logged_at.isoformat(),
                "notes": log.notes,
            }
            for log in logs
        ]
        return Response(data)

    @action(detail=True, methods=["post"], url_path="log_weight")
    def log_weight(self, request, pk=None):
        athlete = self.get_object()
        if request.user.role == "coach" and athlete.coach != request.user:
            return Response(
                {"detail": "Ви можете додавати замери ваги тільки своїм спортсменам."},
                status=status.HTTP_403_FORBIDDEN,
            )

        weight = request.data.get("weight")
        notes = request.data.get("notes", "")
        if not weight:
            return Response(
                {"detail": "Поле weight є обов'язковим."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            weight = float(weight)
        except (ValueError, TypeError):
            return Response(
                {"detail": "Некоректне значення ваги."}, status=status.HTTP_400_BAD_REQUEST
            )

        log = AthleteWeightLog.objects.create(athlete=athlete, weight=weight, notes=notes)

        athlete.base_weight = weight
        athlete.save(update_fields=["base_weight"])

        return Response(
            {
                "id": log.id,
                "weight": float(log.weight),
                "logged_at": log.logged_at.isoformat(),
                "notes": log.notes,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="import_athletes")
    def import_athletes(self, request):
        """
        POST /api/athletes/import_athletes/
        Multipart form-data: {"file": <file>}
        """
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Файл не надано."}, status=status.HTTP_400_BAD_REQUEST)

        filename = file_obj.name.lower()
        content_bytes = file_obj.read()

        rows = []
        if filename.endswith(".csv"):
            try:
                content_text = content_bytes.decode("utf-8")
            except UnicodeDecodeError:
                try:
                    content_text = content_bytes.decode("windows-1251")
                except UnicodeDecodeError:
                    return Response(
                        {
                            "detail": (
                                "Не вдалося розкодувати CSV файл. "
                                "Використовуйте UTF-8 або Windows-1251."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            import csv
            import io

            f = io.StringIO(content_text)
            reader = csv.reader(f)
            try:
                rows = list(reader)
            except Exception as e:
                return Response(
                    {"detail": f"Помилка зчитування CSV: {str(e)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif filename.endswith((".xlsx", ".xls")):
            import io

            import openpyxl

            try:
                wb = openpyxl.load_workbook(io.BytesIO(content_bytes), data_only=True)
                sheet = wb.active
                raw_rows = list(sheet.iter_rows(values_only=True))
                rows = []
                for r in raw_rows:
                    rows.append([str(cell).strip() if cell is not None else "" for cell in r])
            except Exception as e:
                return Response(
                    {"detail": f"Помилка зчитування Excel: {str(e)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            return Response(
                {
                    "detail": (
                        "Непідтримуваний формат файлу. "
                        "Дозволено тільки CSV та Excel (.xlsx/.xls)."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not rows:
            return Response({"detail": "Файл порожній."}, status=status.HTTP_400_BAD_REQUEST)

        # Clean headers
        header = [str(h).strip().lower() for h in rows[0]]

        # Define field mappings (English and Ukrainian variants)
        field_mappings = {
            "first_name": ["first_name", "first name", "ім'я", "імя", "name", "имя"],
            "last_name": ["last_name", "last name", "прізвище", "фамилия"],
            "patronymic": ["patronymic", "по батькові", "по-батькові", "отчество"],
            "gender": ["gender", "sex", "стать", "пол"],
            "birth_date": ["birth_date", "birth date", "дата народження", "дата", "дата рождения"],
            "base_weight": ["base_weight", "weight", "вага", "вес"],
            "skill_level": ["skill_level", "rank", "level", "розряд", "ранг", "пояс"],
        }

        def get_col_index(field_name):
            variants = field_mappings[field_name]
            for i, h in enumerate(header):
                if h in variants:
                    return i
            return None

        idx_first_name = get_col_index("first_name")
        idx_last_name = get_col_index("last_name")
        idx_patronymic = get_col_index("patronymic")
        idx_gender = get_col_index("gender")
        idx_birth_date = get_col_index("birth_date")
        idx_base_weight = get_col_index("base_weight")
        idx_skill_level = get_col_index("skill_level")

        # Validate required columns
        missing_cols = []
        if idx_first_name is None:
            missing_cols.append("Ім'я")
        if idx_last_name is None:
            missing_cols.append("Прізвище")
        if idx_gender is None:
            missing_cols.append("Стать")
        if idx_birth_date is None:
            missing_cols.append("Дата народження")
        if idx_base_weight is None:
            missing_cols.append("Вага")

        if missing_cols:
            return Response(
                {"detail": f"У файлі відсутні обов'язкові колонки: {', '.join(missing_cols)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        club = user.club if hasattr(user, "club") else None
        if not club:
            return Response(
                {"detail": "Тренеру не призначено клуб. Імпорт неможливий."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        imported_count = 0
        errors = []

        from datetime import datetime

        from django.db import transaction

        def get_val(row, idx):
            return row[idx].strip() if idx is not None and idx < len(row) else ""

        try:
            with transaction.atomic():
                for row_num, row in enumerate(rows[1:], start=2):
                    if not row or all(not str(cell).strip() for cell in row):
                        continue

                    try:
                        first_name = get_val(row, idx_first_name)
                        last_name = get_val(row, idx_last_name)
                        patronymic = get_val(row, idx_patronymic)
                        gender_raw = get_val(row, idx_gender).lower()
                        birth_date_raw = get_val(row, idx_birth_date)
                        base_weight_raw = get_val(row, idx_base_weight)
                        skill_level = get_val(row, idx_skill_level)

                        if not first_name or not last_name:
                            raise ValueError("Ім'я та прізвище є обов'язковими.")

                        # Parse gender
                        if gender_raw in ["male", "m", "ч", "чоловік", "чорний"]:
                            gender = "male"
                        elif gender_raw in ["female", "f", "ж", "жінка"]:
                            gender = "female"
                        else:
                            raise ValueError(
                                f"Некоректне значення статі: '{gender_raw}'. "
                                "Очікується 'Ч' або 'Ж'."
                            )

                        # Parse birth date
                        birth_date = None
                        date_formats = ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"]
                        date_str_clean = birth_date_raw.split(" ")[0].strip()
                        for fmt in date_formats:
                            try:
                                birth_date = datetime.strptime(date_str_clean, fmt).date()
                                break
                            except ValueError:
                                continue
                        if not birth_date:
                            raise ValueError(
                                f"Некоректний формат дати народження: '{birth_date_raw}'. "
                                "Спробуйте РРРР-ММ-ДД або ДД.ММ.РРРР."
                            )

                        # Parse weight
                        try:
                            base_weight = float(base_weight_raw.replace(",", "."))
                        except (ValueError, TypeError) as err:
                            msg = f"Некоректне значення ваги: '{base_weight_raw}'."
                            raise ValueError(msg) from err

                        # Create athlete
                        Athlete.objects.create(
                            coach=user,
                            club=club,
                            first_name=first_name,
                            last_name=last_name,
                            patronymic=patronymic,
                            gender=gender,
                            birth_date=birth_date,
                            base_weight=base_weight,
                            skill_level=skill_level,
                        )
                        imported_count += 1
                    except Exception as e:
                        errors.append(f"Рядок {row_num}: {str(e)}")

                if errors:
                    raise Exception("Validation failed")
        except Exception:
            pass

        if errors:
            return Response(
                {
                    "detail": (
                        "Помилка імпорту. Жодного спортсмена "
                        "не було додано через помилки валідації."
                    ),
                    "errors": errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "detail": f"Успішно імпортовано {imported_count} спортсменів.",
                "imported_count": imported_count,
            },
            status=status.HTTP_200_OK,
        )


class TeamViewSet(viewsets.ModelViewSet):
    """CRUD команд з автоматичним фільтром за роллю тренера."""

    serializer_class = TeamSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Team.objects.select_related("club", "coach").prefetch_related("athletes").all()
        if user.role == "coach":
            qs = qs.filter(coach=user)
        return qs

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            from apps.accounts.permissions import IsCoachOrOrganizer

            return [IsCoachOrOrganizer()]
        return [IsAuthenticated()]
