"""
Views турнірного рівня.

TournamentViewSet  — повний CRUD + дії open_registration / start / complete
CategoryViewSet    — CRUD категорій + generate_bracket
RegistrationViewSet— CRUD реєстрацій + confirm_weigh_in
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsOrganizer
from apps.brackets.services import BracketGenerator
from apps.common.pagination import OptionalPageNumberPagination
from apps.matches.serializers import MatchSerializer
from apps.tournaments.models import Category, Registration, Tournament
from apps.tournaments.serializers import (
    CategoryResultSerializer,
    CategorySerializer,
    RegistrationSerializer,
    TournamentDetailSerializer,
    TournamentSerializer,
)
from apps.tournaments.services import calculate_category_standings


class TournamentViewSet(viewsets.ModelViewSet):
    """Турніри: список, деталі, CRUD та управління станом."""

    queryset = Tournament.objects.select_related("organizer").prefetch_related("categories").all()
    pagination_class = OptionalPageNumberPagination

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ("GET", "HEAD", "OPTIONS") and self.action != "pay_platform_fee":
            if obj.status == obj.Status.COMPLETED:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Турнір завершено. Редагування турніру заборонене.")

    def get_queryset(self):
        qs = super().get_queryset()
        staff_member = self.request.query_params.get("staff_member")
        if staff_member == "me" and self.request.user.is_authenticated:
            from django.db.models import Q

            qs = qs.filter(
                Q(staff_members=self.request.user) | Q(organizer=self.request.user)
            ).distinct()
        elif staff_member:
            qs = qs.filter(staff_members__id=staff_member)
        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return TournamentDetailSerializer
        return TournamentSerializer

    def get_permissions(self):
        if self.action in (
            "create",
            "update",
            "partial_update",
            "destroy",
            "open_registration",
            "start",
            "complete",
            "generate_all_brackets",
            "auto_distribute_tatamis",
            "import_categories",
            "pay_platform_fee",
        ):
            return [IsOrganizer()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    def perform_create(self, serializer):
        # Організатор встановлюється автоматично
        serializer.save(organizer=self.request.user)

    # ------------------------------------------------------------------
    # Дії управління станом турніру
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="open_registration")
    def open_registration(self, request, pk=None):
        """POST /api/tournaments/{id}/open_registration/"""
        tournament = self.get_object()
        try:
            tournament.open_registration()
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TournamentSerializer(tournament).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """POST /api/tournaments/{id}/start/"""
        tournament = self.get_object()
        try:
            tournament.start_tournament()
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TournamentSerializer(tournament).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """POST /api/tournaments/{id}/complete/"""
        tournament = self.get_object()
        try:
            tournament.complete_tournament()
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TournamentSerializer(tournament).data)

    @action(detail=True, methods=["post"], url_path="pay_platform_fee")
    def pay_platform_fee(self, request, pk=None):
        """POST /api/tournaments/{id}/pay_platform_fee/"""
        tournament = self.get_object()
        if request.user != tournament.organizer and request.user.role != "admin":
            return Response(
                {"detail": "Лише організатор турніру може сплатити комісію."},
                status=status.HTTP_403_FORBIDDEN,
            )
        tournament.platform_fee_status = "paid"
        tournament.save(update_fields=["platform_fee_status"])
        return Response(TournamentSerializer(tournament).data)

    @action(detail=True, methods=["post"], url_path="generate_all_brackets")
    def generate_all_brackets(self, request, pk=None):
        """POST /api/tournaments/{id}/generate_all_brackets/"""
        tournament = self.get_object()
        categories = tournament.categories.all()

        rules = request.data.get("rules")
        if rules is None:
            # Fallback for backward compatibility & default behavior
            rules = [
                {
                    "format": Category.BracketFormat.ROUND_ROBIN,
                    "min_participants": int(request.data.get("round_robin_min", 2)),
                    "max_participants": int(request.data.get("round_robin_max", 5)),
                },
                {
                    "format": Category.BracketFormat.SINGLE_ELIMINATION,
                    "min_participants": int(request.data.get("single_elimination_min", 6)),
                    "max_participants": int(request.data.get("single_elimination_max", 32)),
                },
            ]

        parsed_rules = []
        for r in rules:
            fmt = r.get("format")
            if fmt not in Category.BracketFormat.values:
                return Response(
                    {"detail": f"Некоректний формат сітки в правилах: {fmt}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            double_elim_type = r.get("double_elim_type")
            if fmt == Category.BracketFormat.DOUBLE_ELIMINATION:
                if not double_elim_type:
                    double_elim_type = Category.DoubleElimType.FULL
                elif double_elim_type not in Category.DoubleElimType.values:
                    return Response(
                        {"detail": f"Некоректний тип Double Elimination: {double_elim_type}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            else:
                double_elim_type = ""

            try:
                min_participants = int(r.get("min_participants", 2))
                max_participants = int(r.get("max_participants", 100))
            except (ValueError, TypeError):
                return Response(
                    {
                        "detail": (
                            "Параметри min_participants та max_participants "
                            "мають бути цілими числами"
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            parsed_rules.append(
                {
                    "format": fmt,
                    "double_elim_type": double_elim_type,
                    "min_participants": min_participants,
                    "max_participants": max_participants,
                }
            )

        generated_count = 0
        errors = []
        for cat in categories:
            if cat.matches.exists():
                continue
            confirmed_count = cat.registrations.filter(status=Registration.Status.CONFIRMED).count()
            if confirmed_count < 2:
                continue

            matched_rule = None
            for rule in parsed_rules:
                if rule["min_participants"] <= confirmed_count <= rule["max_participants"]:
                    matched_rule = rule
                    break

            if not matched_rule:
                continue

            cat.bracket_format = matched_rule["format"]
            cat.double_elim_type = matched_rule["double_elim_type"]
            cat.save(update_fields=["bracket_format", "double_elim_type"])

            try:
                BracketGenerator(cat).generate()
                generated_count += 1
            except DjangoValidationError as exc:
                errors.append(f"Категорія {cat.name}: {exc.message}")

        return Response(
            {"detail": f"Згенеровано сітки для {generated_count} категорій.", "errors": errors},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="auto_distribute_tatamis")
    def auto_distribute_tatamis(self, request, pk=None):
        """POST /api/tournaments/{id}/auto_distribute_tatamis/"""
        tournament = self.get_object()
        active_tatamis = list(tournament.tatamis.filter(is_active=True).order_by("number"))
        if not active_tatamis:
            return Response(
                {"detail": "Немає активних татамі в цьому турнірі."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        categories = list(tournament.categories.all())
        categories_with_matches = [c for c in categories if c.matches.exists()]
        if not categories_with_matches:
            return Response(
                {"detail": "Немає категорій зі згенерованими сітками."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Clear current_match for all tatamis in this tournament since the schedule is reshuffled
        from apps.common.broadcast import broadcast_tatami_state

        for t in tournament.tatamis.all():
            if t.current_match:
                t.current_match = None
                t.save(update_fields=["current_match"])
                broadcast_tatami_state(t)

        # Greedy load-balancing sorting by match count descending
        categories_with_matches.sort(key=lambda c: c.matches.count(), reverse=True)

        tatami_loads = {t.id: 0 for t in active_tatamis}
        assignments = []

        for cat in categories_with_matches:
            least_loaded_tatami = min(active_tatamis, key=lambda t: tatami_loads[t.id])
            cat.matches.update(tatami=least_loaded_tatami)
            match_count = cat.matches.count()
            tatami_loads[least_loaded_tatami.id] += match_count
            assignments.append(
                {
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "tatami_id": least_loaded_tatami.id,
                    "tatami_number": least_loaded_tatami.number,
                    "matches_count": match_count,
                }
            )

        return Response(
            {
                "detail": (
                    f"Успішно розподілено {len(categories_with_matches)} "
                    f"категорій по {len(active_tatamis)} татамі."
                ),
                "assignments": assignments,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="import_categories")
    def import_categories(self, request, pk=None):
        """POST /api/tournaments/{id}/import_categories/
        Приймає {"names": [...]} та створює категорії bulk за допомогою розумного NLP-парсеру.
        """
        tournament = self.get_object()
        names = request.data.get("names")
        if not isinstance(names, list) or not names:
            return Response(
                {"detail": "Поле 'names' має бути непустим списком."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.db import transaction

        created_categories = []

        try:
            with transaction.atomic():
                for name_str in names:
                    if not isinstance(name_str, str) or not name_str.strip():
                        continue

                    parsed = parse_category_name(name_str, tournament.sport_type)
                    category = Category.objects.create(
                        tournament=tournament,
                        name=parsed["name"],
                        allowed_gender=parsed["allowed_gender"],
                        min_age=parsed["min_age"],
                        max_age=parsed["max_age"],
                        min_weight=parsed["min_weight"],
                        max_weight=parsed["max_weight"],
                        ruleset_key=parsed["ruleset_key"],
                        bracket_format=parsed["bracket_format"],
                    )
                    created_categories.append(category)
        except Exception as exc:
            return Response(
                {"detail": f"Помилка при імпорті категорій: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            CategorySerializer(created_categories, many=True).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="statistics")
    def statistics(self, request, pk=None):
        """GET /api/tournaments/{id}/statistics/"""
        tournament = self.get_object()
        from apps.tournaments.statistics import get_tournament_statistics

        stats = get_tournament_statistics(tournament.id)
        return Response(stats, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="global-ratings")
    def global_ratings(self, request):
        """GET /api/tournaments/global-ratings/"""
        from apps.tournaments.statistics import get_global_ratings

        ratings = get_global_ratings()
        return Response(ratings, status=status.HTTP_200_OK)


def parse_category_name(name_str: str, sport_type: str) -> dict:
    import re

    name_clean = name_str.strip()
    lower_name = name_clean.lower()

    # 1. Parse gender
    allowed_gender = Category.AllowedGender.MIXED
    if any(w in lower_name for w in ["хлоп", "чол", "boy", "man", "men", "male"]):
        allowed_gender = Category.AllowedGender.MALE
    elif any(w in lower_name for w in ["дівчат", "жін", "girl", "woman", "women", "female"]):
        allowed_gender = Category.AllowedGender.FEMALE

    # 2. Parse age
    min_age = 0
    max_age = 99

    # Extract patterns and replace them in the search string for weight
    range_match = re.search(
        r"(\d+)\s*[-–]\s*(\d+)\s*(?:років|року|р\.?|years|y\.?o\.?)?",
        name_clean,
        re.IGNORECASE,
    )
    u_match = re.search(r"\bU\s*(\d+)\b", name_clean, re.IGNORECASE)
    plus_match = re.search(
        r"(\d+)\s*(?:років|р\.|р|years|\+)\s*(?:\+|і старше|понад|and older)",
        name_clean,
        re.IGNORECASE,
    )
    if not plus_match:
        plus_match = re.search(r"(\d+)\s*\+", name_clean)

    under_match = re.search(
        r"(?:до|under)\s*(\d+)\s*(?:років|р\.|р|years|yo)?",
        name_clean,
        re.IGNORECASE,
    )

    weight_search_str = name_clean

    if range_match:
        min_age = int(range_match.group(1))
        max_age = int(range_match.group(2))
        weight_search_str = weight_search_str.replace(range_match.group(0), "")
    elif u_match:
        min_age = 0
        max_age = int(u_match.group(1))
        weight_search_str = weight_search_str.replace(u_match.group(0), "")
    elif plus_match:
        min_age = int(plus_match.group(1))
        max_age = 99
        weight_search_str = weight_search_str.replace(plus_match.group(0), "")
    elif under_match:
        min_age = 0
        max_age = int(under_match.group(1))
        weight_search_str = weight_search_str.replace(under_match.group(0), "")
    else:
        simple_age = re.search(
            r"(\d+)\s*(?:років|р\.|р|року|years|yo)\b", name_clean, re.IGNORECASE
        )
        if simple_age:
            min_age = int(simple_age.group(1))
            max_age = int(simple_age.group(1))
            weight_search_str = weight_search_str.replace(simple_age.group(0), "")

    # 3. Parse weight
    min_weight = None
    max_weight = None

    w_range = re.search(
        r"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:кг|kg)?",
        weight_search_str,
        re.IGNORECASE,
    )
    w_under = re.search(
        r"(?:до|under|-)\s*(\d+(?:\.\d+)?)\s*(?:кг|kg)",
        weight_search_str,
        re.IGNORECASE,
    )
    if not w_under:
        w_under = re.search(r"(?:до|under)\s*(\d+(?:\.\d+)?)", weight_search_str, re.IGNORECASE)
        if not w_under:
            w_under = re.search(
                r"-\s*(\d+(?:\.\d+)?)\s*(?:кг|kg)?",
                weight_search_str,
                re.IGNORECASE,
            )

    w_over = re.search(
        r"(?:від|понад|over|\+)\s*(\d+(?:\.\d+)?)",
        weight_search_str,
        re.IGNORECASE,
    )
    if not w_over:
        if "+" in weight_search_str:
            parts = weight_search_str.split("+")
            stripped = parts[0].rstrip()
            last_number = ""
            for char in reversed(stripped):
                if char.isdigit() or char == ".":
                    last_number = char + last_number
                elif last_number:
                    break
            if last_number:
                try:
                    float(last_number)

                    class DummyMatch:
                        def group(self, _idx):
                            return last_number

                    w_over = DummyMatch()
                except ValueError:
                    pass
        else:
            parts = re.split(r"\b(?:plus|плюс)\b", weight_search_str, flags=re.IGNORECASE)
            if len(parts) > 1:
                stripped = parts[0].rstrip()
                last_number = ""
                for char in reversed(stripped):
                    if char.isdigit() or char == ".":
                        last_number = char + last_number
                    elif last_number:
                        break
                if last_number:
                    try:
                        float(last_number)

                        class DummyMatch:
                            def group(self, _idx):
                                return last_number

                        w_over = DummyMatch()
                    except ValueError:
                        pass

    if w_range:
        min_weight = float(w_range.group(1))
        max_weight = float(w_range.group(2))
    elif w_under:
        max_weight = float(w_under.group(1))
    elif w_over:
        min_weight = float(w_over.group(1))

    # 4. Map default ruleset based on tournament's sport type
    ruleset_key = "karate_wkf"
    sport_lower = sport_type.lower() if sport_type else ""
    if "ippon" in sport_lower or "shobu" in sport_lower:
        ruleset_key = "shobu_ippon"

    # 5. Parse bracket format from name
    bracket_format = Category.BracketFormat.SINGLE_ELIMINATION
    if any(w in lower_name for w in ["круг", "round robin", "rr"]):
        bracket_format = Category.BracketFormat.ROUND_ROBIN
    elif any(w in lower_name for w in ["швейц", "swiss", "швейцар"]):
        bracket_format = Category.BracketFormat.SWISS
    elif any(w in lower_name for w in ["репеш", "repechage", "rep"]):
        bracket_format = Category.BracketFormat.SINGLE_ELIM_REPECHAGE
    elif any(w in lower_name for w in ["double", "подвійн", "de"]):
        bracket_format = Category.BracketFormat.DOUBLE_ELIMINATION

    return {
        "name": name_clean,
        "allowed_gender": allowed_gender,
        "min_age": min_age,
        "max_age": max_age,
        "min_weight": min_weight,
        "max_weight": max_weight,
        "ruleset_key": ruleset_key,
        "bracket_format": bracket_format,
    }


class CategoryViewSet(viewsets.ModelViewSet):
    """Категорії турніру. Вкладені під турнір через query param tournament."""

    serializer_class = CategorySerializer

    def get_queryset(self):
        qs = Category.objects.select_related("tournament").prefetch_related("registrations")
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(tournament_id=tournament_id)
        return qs

    def get_permissions(self):
        if self.action in (
            "create",
            "update",
            "partial_update",
            "destroy",
            "generate_bracket",
            "delete_bracket",
            "assign_tatami",
        ):
            return [IsOrganizer()]
        if self.action in (
            "save_results",
            "unlock_results",
            "set_judges_count",
            "generate_next_swiss_round",
        ):
            from apps.accounts.permissions import IsJudgeOrOrganizer

            return [IsJudgeOrOrganizer()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if obj.tournament.status == obj.tournament.Status.COMPLETED:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Турнір завершено. Модифікація категорії заборонена.")

    def perform_create(self, serializer):
        # tournament передається у тілі запиту; перевіряємо, що організатор — власник
        tournament = serializer.validated_data["tournament"]
        if tournament.status == tournament.Status.COMPLETED:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Турнір завершено. Створення категорії заборонене.")
        if tournament.organizer != self.request.user and not self.request.user.is_staff:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Ви не є організатором цього турніру.")
        serializer.save()

    @action(detail=True, methods=["post"], url_path="generate_bracket")
    def generate_bracket(self, request, pk=None):
        """POST /api/categories/{id}/generate_bracket/
        Генерує турнірну сітку для категорії та повертає список матчів.
        """
        category = self.get_object()
        bracket_format = request.data.get("bracket_format")
        if bracket_format:
            if bracket_format not in Category.BracketFormat.values:
                return Response(
                    {"detail": f"Некоректний формат сітки: {bracket_format}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            category.bracket_format = bracket_format
            update_fields = ["bracket_format"]

            if bracket_format == Category.BracketFormat.DOUBLE_ELIMINATION:
                double_elim_type = request.data.get("double_elim_type", "full")
                if double_elim_type not in Category.DoubleElimType.values:
                    return Response(
                        {"detail": f"Некоректний тип Double Elimination: {double_elim_type}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                category.double_elim_type = double_elim_type
                update_fields.append("double_elim_type")
            else:
                category.double_elim_type = ""
                update_fields.append("double_elim_type")

            category.save(update_fields=update_fields)

        try:
            matches = BracketGenerator(category).generate()
        except DjangoValidationError as exc:
            return Response(
                {"detail": exc.message},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            MatchSerializer(matches, many=True).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="delete_bracket")
    def delete_bracket(self, request, pk=None):
        """POST /api/categories/{id}/delete_bracket/
        Видаляє всі матчі для категорії.
        """
        category = self.get_object()
        matches = category.matches.all()
        count = matches.count()
        matches.delete()
        return Response(
            {"detail": f"Успішно видалено {count} матчів сітки."}, status=status.HTTP_200_OK
        )

    @action(detail=True, methods=["post"], url_path="generate_next_swiss_round")
    @transaction.atomic
    def generate_next_swiss_round(self, request, pk=None):
        """POST /api/categories/{id}/generate_next_swiss_round/
        Генерує наступний раунд швейцарської системи.
        """
        category = self.get_object()
        self._verify_judge_permission(category, request.user)

        from apps.brackets.services import BracketGenerator

        try:
            created_matches = BracketGenerator(category).generate_next_swiss_round()
        except DjangoValidationError as exc:
            return Response(
                {"detail": exc.message},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            MatchSerializer(created_matches, many=True).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="assign_tatami")
    def assign_tatami(self, request, pk=None):
        """POST /api/categories/{id}/assign_tatami/
        Тіло: {"tatami_id": int}
        """
        category = self.get_object()
        tatami_id = request.data.get("tatami_id")
        if not tatami_id:
            return Response(
                {"detail": "Поле 'tatami_id' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            from apps.tatamis.models import Tatami

            tatami = Tatami.objects.get(id=int(tatami_id), tournament=category.tournament)
        except (Tatami.DoesNotExist, ValueError, TypeError):
            return Response(
                {"detail": "Вказано некоректний або неіснуючий ID татамі для цього турніру."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        category.matches.update(tatami=tatami)

        # Clear current_match on other tatamis for matches of this category
        from apps.common.broadcast import broadcast_tatami_state

        affected_tatamis = Tatami.objects.filter(
            tournament=category.tournament, current_match__category=category
        ).exclude(id=tatami.id)
        for t in affected_tatamis:
            t.current_match = None
            t.save(update_fields=["current_match"])
            broadcast_tatami_state(t)

        return Response(
            {"detail": f"Усі матчі категорії успішно призначено на татамі №{tatami.number}."},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"], url_path="results")
    def results(self, request, pk=None):
        """GET /api/categories/{id}/results/
        Розраховує та повертає поточні результати категорії.
        """
        category = self.get_object()
        results_data = calculate_category_standings(category, persist=False)
        serializer = CategoryResultSerializer(results_data, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def _verify_judge_permission(self, category, user):
        if user.is_authenticated and user.role == "judge":
            match = category.matches.first()
            if match and match.tatami:
                if match.tatami.assigned_judge_id != user.id:
                    from rest_framework.exceptions import PermissionDenied

                    raise PermissionDenied("Ви не є призначеним суддею на татамі цієї категорії.")
            else:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Категорія не призначена на жодне татамі.")

    def _broadcast_results_update(self, category):
        # Broadcast state to all relevant tatami WS channels
        from django.db.models import Q

        from apps.common.broadcast import broadcast_tatami_state
        from apps.tatamis.models import Tatami

        matching_tatamis = Tatami.objects.filter(
            Q(current_match__category=category) | Q(active_results_category=category)
        )
        for tatami in matching_tatamis:
            broadcast_tatami_state(tatami)

        # Broadcast to category channel to trigger spectator page updates
        from apps.common.broadcast import broadcast_category_results_update

        broadcast_category_results_update(category.id)

    @action(detail=True, methods=["post"], url_path="save_results")
    def save_results(self, request, pk=None):
        """POST /api/categories/{id}/save_results/
        Розраховує та фіксує результати категорії у базу даних з підтримкою ручних перевизначень.
        """
        category = self.get_object()
        self._verify_judge_permission(category, request.user)

        overrides = request.data.get("overrides")
        if overrides is not None and isinstance(overrides, dict):
            from django.db import transaction

            with transaction.atomic():
                # Очищаємо старі місця в цій категорії
                Registration.objects.filter(category=category).update(place=None)
                # Записуємо нові призові місця з перевизначень
                for reg_id_str, place_val in overrides.items():
                    if place_val is not None:
                        try:
                            place_int = int(place_val)
                            Registration.objects.filter(
                                id=int(reg_id_str), category=category
                            ).update(place=place_int)
                        except (ValueError, TypeError):
                            pass
            results_data = calculate_category_standings(category, persist=False)
        else:
            # Використовуємо автоматичний розрахунок
            results_data = calculate_category_standings(category, persist=True)

        self._broadcast_results_update(category)

        serializer = CategoryResultSerializer(results_data, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unlock_results")
    def unlock_results(self, request, pk=None):
        """POST /api/categories/{id}/unlock_results/
        Скидає зафіксовані результати категорії.
        """
        category = self.get_object()
        self._verify_judge_permission(category, request.user)

        Registration.objects.filter(category=category).update(place=None)

        self._broadcast_results_update(category)

        return Response({"detail": "Фіксацію результатів скасовано."}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="set_judges_count")
    def set_judges_count(self, request, pk=None):
        """POST /api/categories/{id}/set_judges_count/
        Встановлює кількість суддів для Ката (3 або 5).
        """
        category = self.get_object()
        judges_count = request.data.get("judges_count")
        if judges_count not in (3, 5, "3", "5"):
            return Response(
                {"detail": "Кількість суддів повинна бути 3 або 5."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.db import transaction

        from apps.matches.services.match_service import MatchService

        try:
            with transaction.atomic():
                category.judges_count = int(judges_count)
                category.save(update_fields=["judges_count"])

                # Оновлюємо кожен матч за допомогою MatchService для скидання та валідації
                for match in category.matches.all():
                    svc = MatchService(match)
                    svc.set_judges_count(int(judges_count), judge=request.user)
        except (ValueError, DjangoValidationError) as exc:
            msg = exc.message if hasattr(exc, "message") else str(exc)
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(CategorySerializer(category).data, status=status.HTTP_200_OK)


class RegistrationViewSet(viewsets.ModelViewSet):
    """Реєстрації спортсменів на категорії."""

    serializer_class = RegistrationSerializer
    from apps.common.pagination import OptionalPageNumberPagination

    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        user = self.request.user
        qs = Registration.objects.select_related("athlete", "athlete__club", "category", "team")
        if user.is_authenticated and user.role == "coach" and self.action == "list":
            from django.db.models import Q

            qs = qs.filter(Q(athlete__coach=user) | Q(team__coach=user))
        category_id = self.request.query_params.get("category")
        if category_id:
            qs = qs.filter(category_id=category_id)
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(category__tournament_id=tournament_id)
        return qs

    def get_permissions(self):
        if self.action in ("confirm_weigh_in", "check_in", "update", "partial_update"):
            from apps.accounts.permissions import IsTournamentStaffOrOrganizer

            return [IsTournamentStaffOrOrganizer()]
        if self.action in ("create", "destroy", "bulk_pay"):
            from apps.accounts.permissions import IsCoachOrOrganizer

            return [IsCoachOrOrganizer()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    def perform_update(self, serializer):
        from rest_framework.exceptions import ValidationError

        instance = serializer.instance
        if instance and instance.category.tournament.status == "completed":
            raise ValidationError("Редагування реєстрацій завершеного турніру заблоковано.")
        instance = serializer.save()
        from apps.common.broadcast import broadcast_registration_update

        broadcast_registration_update(instance)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.category.tournament.status == "completed":
            return Response(
                {"detail": "Видалення реєстрацій завершеного турніру заблоковано."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Security check: coach can only delete their own athletes' / teams' registrations
        if request.user.role == "coach":
            coach = None
            if instance.athlete:
                coach = instance.athlete.coach
            elif instance.team:
                coach = instance.team.coach

            if coach != request.user:
                return Response(
                    {"detail": "Ви можете видаляти тільки власні заявки."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if instance.category.matches.exists():
            return Response(
                {"detail": "Неможливо видалити реєстрацію, оскільки сітка змагань уже сформована."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="confirm_weigh_in")
    def confirm_weigh_in(self, request, pk=None):
        """POST /api/registrations/{id}/confirm_weigh_in/
        Тіло: {"weight": 74.5}
        """
        registration = self.get_object()
        if registration.category.tournament.status == "completed":
            return Response(
                {"detail": "Зважування заблоковано, оскільки турнір уже завершено."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        weight = request.data.get("weight")
        if weight is None:
            if registration.category.is_team:
                weight = 0.0
            else:
                return Response(
                    {"detail": "Поле weight є обов'язковим."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        try:
            registration.confirm_weigh_in(float(weight))
        except (ValueError, TypeError):
            return Response(
                {"detail": "Некоректне значення ваги."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except DjangoValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.common.broadcast import broadcast_registration_update

        broadcast_registration_update(registration)

        return Response(RegistrationSerializer(registration).data)

    @action(detail=True, methods=["post"], url_path="check_in")
    def check_in(self, request, pk=None):
        """POST /api/registrations/{id}/check_in/
        Перемикає checked_in статус реєстрації.
        """
        registration = self.get_object()
        if registration.category.tournament.status == "completed":
            return Response(
                {"detail": "Реєстрація на турнірі заблокована, оскільки турнір уже завершено."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        registration.checked_in = not registration.checked_in
        registration.save(update_fields=["checked_in"])

        from apps.common.broadcast import broadcast_registration_update

        broadcast_registration_update(registration)

        return Response(RegistrationSerializer(registration).data)

    @action(detail=False, methods=["post"], url_path="bulk_pay")
    def bulk_pay(self, request):
        """POST /api/registrations/bulk_pay/
        Тіло: {"registration_ids": [1, 2, 3], "payment_method": "online"}
        """
        registration_ids = request.data.get("registration_ids", [])
        payment_method = request.data.get("payment_method", "online")

        if not isinstance(registration_ids, list):
            return Response(
                {"detail": "registration_ids має бути списком."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        registrations = Registration.objects.filter(id__in=registration_ids).select_related(
            "athlete__coach", "team__coach"
        )
        if registrations.filter(category__tournament__status="completed").exists():
            return Response(
                {"detail": "Недійсний запит: один або кілька турнірів завершено."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.user.role == "coach":
            for reg in registrations:
                if reg.athlete and reg.athlete.coach != request.user:
                    return Response(
                        {"detail": "Ви можете оплачувати лише власні реєстрації."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if reg.team and reg.team.coach != request.user:
                    return Response(
                        {"detail": "Ви можете оплачувати лише власні реєстрації."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        updated_count = registrations.update(payment_status="paid", payment_method=payment_method)
        return Response(
            {"detail": f"Успішно оновлено {updated_count} реєстрацій."},
            status=status.HTTP_200_OK,
        )
