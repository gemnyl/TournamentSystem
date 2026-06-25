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
        Tournament.auto_transition_statuses()
        qs = super().get_queryset()
        staff_member = self.request.query_params.get("staff_member")
        if staff_member == "me" and self.request.user.is_authenticated:
            from django.db.models import Q

            qs = qs.filter(
                Q(staff_members=self.request.user)
                | Q(organizer=self.request.user)
                | Q(chief_judge=self.request.user)
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
            "generate_all_brackets",
            "auto_distribute_tatamis",
            "import_categories",
            "update",
            "partial_update",
        ):
            from apps.accounts.permissions import IsTournamentChiefJudgeOrOrganizer

            return [IsTournamentChiefJudgeOrOrganizer()]
        if self.action in (
            "create",
            "destroy",
            "open_registration",
            "start",
            "complete",
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

    @action(detail=True, methods=["get"], url_path="finance_report")
    def finance_report(self, request, pk=None):
        """GET /api/tournaments/{id}/finance_report/"""
        tournament = self.get_object()
        if tournament.organizer != request.user and request.user.role != "admin":
            return Response(
                {
                    "detail": "Доступ заблоковано. Лише організатор "
                    "турніру може бачити фінансовий звіт."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        from django.db.models import Sum

        from apps.billing.views import calculate_registration_fee

        # Усі реєстрації турніру
        all_regs = Registration.objects.filter(category__tournament=tournament)
        active_regs = all_regs.exclude(status__in=["rejected", "withdrawn"])

        # Оплачені реєстрації включають зняті (withdrawn), якщо їхня оплата
        # ще не скасована (до завершення турніру або у разі non_refundable правил)
        online_paid = all_regs.filter(payment_status="paid", payment_method="online")
        offline_paid = all_regs.filter(payment_status="paid", payment_method="offline")

        online_revenue = sum(calculate_registration_fee(r) for r in online_paid)
        offline_revenue = sum(calculate_registration_fee(r) for r in offline_paid)

        # Розрахунок комісії платформи
        platform_fee_held = 0
        for r in online_paid:
            price = calculate_registration_fee(r)
            platform_fee_held += int(price * 0.05)

        platform_fee_offline_debt = 0
        for r in offline_paid:
            price = calculate_registration_fee(r)
            platform_fee_offline_debt += int(price * 0.05)

        platform_fee_total = platform_fee_held + platform_fee_offline_debt

        if tournament.platform_fee_status == "paid":
            platform_fee_debt = 0
            platform_fee_paid = platform_fee_offline_debt
        else:
            platform_fee_debt = platform_fee_offline_debt
            platform_fee_paid = 0

        # Загальний борг організатора перед платформою за ВСІ completed турніри
        total_debt = (
            Tournament.objects.filter(
                organizer=request.user,
                status=Tournament.Status.COMPLETED,
                platform_fee_status="unpaid",
                platform_fee_amount__gt=0,
            ).aggregate(total=Sum("platform_fee_amount"))["total"]
            or 0
        )

        # Розрахунок виплат організатору
        from apps.billing.models import PayoutRequest

        withdrawn_funds = (
            PayoutRequest.objects.filter(
                tournament=tournament, status=PayoutRequest.Status.COMPLETED
            ).aggregate(total=Sum("amount"))["total"]
            or 0
        )

        pending_withdrawn_funds = (
            PayoutRequest.objects.filter(
                tournament=tournament, status=PayoutRequest.Status.PENDING
            ).aggregate(total=Sum("amount"))["total"]
            or 0
        )

        if tournament.platform_fee_status == "unpaid":
            available_balance = max(
                0,
                online_revenue
                - platform_fee_held
                - platform_fee_offline_debt
                - withdrawn_funds
                - pending_withdrawn_funds,
            )
        else:
            available_balance = max(
                0, online_revenue - platform_fee_held - withdrawn_funds - pending_withdrawn_funds
            )

        report = {
            "total_revenue": online_revenue + offline_revenue,
            "total_entries_count": active_regs.count(),
            "online_funds": online_revenue,
            "online_entries_count": online_paid.count(),
            "offline_funds": offline_revenue,
            "offline_entries_count": offline_paid.count(),
            "platform_fee_total": platform_fee_total,
            "platform_fee_held": platform_fee_held,
            "platform_fee_offline_debt": platform_fee_offline_debt,
            "platform_fee_paid": platform_fee_paid,
            "platform_fee_debt": platform_fee_debt,
            "organizer_credit_limit": request.user.credit_limit,
            "organizer_total_debt": total_debt,
            "withdrawn_funds": withdrawn_funds,
            "pending_withdrawn_funds": pending_withdrawn_funds,
            "available_balance": available_balance,
        }
        return Response(report, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="admin_platform_debts")
    def admin_platform_debts(self, request):
        """GET /api/tournaments/admin_platform_debts/"""
        if request.user.role != "admin":
            return Response({"detail": "Доступ заблоковано."}, status=status.HTTP_403_FORBIDDEN)

        debts = Tournament.objects.filter(
            status=Tournament.Status.COMPLETED,
            platform_fee_status="unpaid",
            platform_fee_amount__gt=0,
        ).select_related("organizer")

        data = []
        for t in debts:
            data.append(
                {
                    "tournament_id": t.id,
                    "title": t.title,
                    "organizer_name": t.organizer.get_full_name(),
                    "organizer_email": t.organizer.email,
                    "amount": t.platform_fee_amount,
                    "completed_at": t.completed_at,
                }
            )
        return Response(data, status=status.HTTP_200_OK)

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

    sport_lower = sport_type.strip().lower() if sport_type else ""

    taekwondo_syns = ["taekwondo", "тхеквондо", "тхекводно", "тхэквондо", "тхэкванд"]
    if any(x in sport_lower for x in taekwondo_syns):
        ruleset_key = "taekwondo_wt"
    elif any(x in sport_lower for x in ["judo", "дзюдо", "ijf"]):
        ruleset_key = "judo_ijf"
    elif any(x in sport_lower for x in ["karate", "карате"]):
        if any(x in lower_name for x in ["kata", "ката"]):
            ruleset_key = "karate_kata"
        elif any(x in lower_name for x in ["ippon", "shobu", "іппон", "сьобу"]):
            ruleset_key = "shobu_ippon"
        else:
            ruleset_key = "karate_wkf"
    else:
        # Fallback dynamic matching if sport_type is blank/unrecognized
        if any(
            x in sport_lower or x in lower_name
            for x in ["taekwondo", "wt", "тхеквондо", "тхекводно", "тхэквондо", "тхэкванд"]
        ):
            ruleset_key = "taekwondo_wt"
        elif any(x in sport_lower or x in lower_name for x in ["judo", "ijf", "дзюдо"]):
            ruleset_key = "judo_ijf"
        elif any(x in sport_lower or x in lower_name for x in ["kata", "ката"]):
            ruleset_key = "karate_kata"
        elif any(x in sport_lower or x in lower_name for x in ["ippon", "shobu", "іппон", "сьобу"]):
            ruleset_key = "shobu_ippon"
        else:
            ruleset_key = "karate_wkf"

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
            from apps.accounts.permissions import IsTournamentChiefJudgeOrOrganizer

            return [IsTournamentChiefJudgeOrOrganizer()]
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
        if (
            tournament.organizer != self.request.user
            and tournament.chief_judge != self.request.user
            and not self.request.user.is_staff
        ):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Ви не є організатором чи головним суддею цього турніру.")
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
            if category.tournament.chief_judge_id == user.id:
                return
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

    from django_filters.rest_framework import DjangoFilterBackend
    from rest_framework.filters import OrderingFilter, SearchFilter

    class RegistrationOrderingFilter(OrderingFilter):
        def filter_queryset(self, request, queryset, view):
            ordering = self.get_ordering(request, queryset, view)
            if ordering:
                new_ordering = []
                for field in ordering:
                    if field == "athlete__weight":
                        new_ordering.append("athlete__base_weight")
                    elif field == "-athlete__weight":
                        new_ordering.append("-athlete__base_weight")
                    else:
                        new_ordering.append(field)
                return queryset.order_by(*new_ordering)
            return queryset

    filter_backends = [DjangoFilterBackend, SearchFilter, RegistrationOrderingFilter]
    filterset_fields = ["category", "athlete__club", "athlete__gender"]
    search_fields = ["athlete__first_name", "athlete__last_name", "athlete__club__name"]
    ordering_fields = [
        "athlete__last_name",
        "category__name",
        "athlete__weight",
        "athlete__base_weight",
        "recorded_weight",
    ]

    def get_queryset(self):
        user = self.request.user
        qs = Registration.objects.select_related(
            "athlete",
            "athlete__club",
            "athlete__coach",
            "category",
            "category__tournament",
            "team",
            "team__club",
            "team__coach",
        ).prefetch_related("payment_invoices", "payment_invoices__registrations")
        if user.is_authenticated and user.role == "coach" and self.action == "list":
            from django.db.models import Q

            club_scope = self.request.query_params.get("club_scope") == "true"
            if club_scope and user.is_club_leader and user.club:
                qs = qs.filter(Q(athlete__club=user.club) | Q(team__club=user.club))
            else:
                qs = qs.filter(Q(athlete__coach=user) | Q(team__coach=user))
        category_id = self.request.query_params.get("category")
        if category_id:
            qs = qs.filter(category_id=category_id)
        tournament_id = self.request.query_params.get(
            "tournament"
        ) or self.request.query_params.get("tournament_id")
        if tournament_id:
            qs = qs.filter(category__tournament_id=tournament_id)
        return qs

    def get_permissions(self):
        if self.action in (
            "confirm_weigh_in",
            "check_in",
            "bulk_update_secretary",
        ):
            from apps.accounts.permissions import IsTournamentStaffOrOrganizer

            return [IsTournamentStaffOrOrganizer()]
        if self.action in ("update", "partial_update"):
            from rest_framework import permissions

            class IsCoachOrStaffForRegistration(permissions.BasePermission):
                def has_permission(self, request, view):
                    return bool(request.user and request.user.is_authenticated)

                def has_object_permission(self, request, view, obj):
                    if not request.user or not request.user.is_authenticated:
                        return False
                    if request.user.role == "admin":
                        return True
                    if request.user.role == "coach":
                        coach = None
                        if obj.athlete:
                            coach = obj.athlete.coach
                        elif obj.team:
                            coach = obj.team.coach
                        return coach == request.user
                    tournament = obj.category.tournament
                    if tournament.organizer == request.user:
                        return True
                    if tournament.staff_members.filter(id=request.user.id).exists():
                        return True
                    return False

            return [IsCoachOrStaffForRegistration()]
        if self.action in ("create", "destroy", "bulk_pay"):
            from apps.accounts.permissions import IsCoachOrOrganizer

            return [IsCoachOrOrganizer()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    def perform_update(self, serializer):
        from rest_framework.exceptions import PermissionDenied, ValidationError

        instance = serializer.instance
        user = self.request.user

        if instance and instance.category.tournament.status == "completed":
            raise ValidationError("Редагування реєстрацій завершеного турніру заблоковано.")

        if user.is_authenticated and user.role == "coach":
            coach = None
            if instance.athlete:
                coach = instance.athlete.coach
            elif instance.team:
                coach = instance.team.coach

            if coach != user:
                raise PermissionDenied("Ви можете редагувати тільки власні заявки.")

            # Validate that coach is only setting status to 'withdrawn'
            validated_keys = set(serializer.validated_data.keys())
            if (
                not validated_keys.issubset({"status"})
                or serializer.validated_data.get("status") != "withdrawn"
            ):
                raise ValidationError(
                    "Тренер може тільки змінювати статус заявки на 'withdrawn' (знято)."
                )

        old_status = instance.status
        old_payment_status = instance.payment_status
        old_payment_method = instance.payment_method

        instance = serializer.save()

        # Перевірка на перехід у статус withdrawn для повернення коштів
        if old_status != "withdrawn" and instance.status == "withdrawn":
            if old_payment_status == "paid":
                tournament = instance.category.tournament
                if tournament.refund_policy == "refundable":
                    if tournament.status not in [
                        Tournament.Status.ACTIVE,
                        Tournament.Status.COMPLETED,
                    ]:
                        if old_payment_method == "online":
                            import uuid

                            from apps.billing.models import PaymentInvoice, Transaction
                            from apps.billing.services import MonobankService
                            from apps.billing.views import calculate_registration_fee

                            invoice = instance.payment_invoices.filter(
                                status=PaymentInvoice.Status.PAID
                            ).first()
                            if invoice and invoice.invoice_id:
                                try:
                                    base_fee = calculate_registration_fee(instance)
                                    if tournament.commission_payer == "buyer":
                                        price_to_refund = base_fee
                                    else:
                                        price_to_refund = int(base_fee * 0.95)

                                    if instance.athlete:
                                        name = (
                                            f"{instance.athlete.last_name} "
                                            f"{instance.athlete.first_name}"
                                        )
                                    elif instance.team:
                                        name = instance.team.name
                                    else:
                                        name = ""
                                    ref_id = f"REF-{uuid.uuid4().hex[:8]}-{name}"[:100]

                                    MonobankService.refund_invoice(
                                        invoice_id=invoice.invoice_id,
                                        amount_uah=price_to_refund,
                                        ext_ref=ref_id,
                                    )

                                    # Фіксуємо транзакцію повернення
                                    Transaction.objects.create(
                                        invoice=invoice,
                                        user=invoice.user,
                                        payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
                                        transaction_type=Transaction.Type.REFUND,
                                        amount=-price_to_refund,
                                        method=Transaction.Method.ONLINE,
                                        reference=ref_id,
                                        monobank_receipt_id=invoice.transactions.first().monobank_receipt_id
                                        if invoice.transactions.exists()
                                        else None,
                                        receipt_url=invoice.transactions.first().receipt_url
                                        if invoice.transactions.exists()
                                        else None,
                                    )

                                    instance.payment_status = "unpaid"
                                    instance.save(update_fields=["payment_status"])
                                except Exception:
                                    # У дипломному проекті припустимо ігнорувати помилку з'єднання
                                    pass
                        elif old_payment_method == "offline":
                            # Офлайн-оплата готівкою залишається зі статусом "paid"
                            # (і відображається як "Знято (Оч. пов.)") до тих пір,
                            # поки організатор фізично не поверне кошти та не
                            # змінить статус оплати на "unpaid"
                            pass

        from apps.common.broadcast import broadcast_registration_update

        broadcast_registration_update(instance)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.category.tournament.status == "completed":
            return Response(
                {"detail": "Видалення реєстрацій завершеного турніру заблоковано."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Забороняємо видалення сплачених реєстрацій (тільки зняття через статус)
        if instance.payment_status == "paid":
            return Response(
                {
                    "detail": (
                        "Неможливо видалити сплачену реєстрацію. Замість "
                        "видалення зніміть її з турніру (статус 'Знято')."
                    )
                },
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
        if not registration.category.tournament.weigh_in_required:
            return Response(
                {"detail": "Зважування не потрібне для цього турніру."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

    @action(detail=False, methods=["post"], url_path="athlete_weigh_in")
    def athlete_weigh_in(self, request):
        """POST /api/registrations/athlete_weigh_in/
        Тіло: {
            "athlete_id": 1,
            "team_id": 1,
            "tournament_id": 2,
            "weight": 74.5
        }
        """
        if not request.user or not request.user.is_authenticated:
            return Response(
                {"detail": "Автентифікація обов'язкова."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        athlete_id = request.data.get("athlete_id")
        team_id = request.data.get("team_id")
        tournament_id = request.data.get("tournament_id")
        weight_val = request.data.get("weight")

        if not tournament_id:
            return Response(
                {"detail": "tournament_id обов'язковий."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if weight_val is None:
            if team_id:
                weight_val = 0.0
            else:
                return Response(
                    {"detail": "Поле weight є обов'язковим."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            weight = float(weight_val)
        except (ValueError, TypeError):
            return Response(
                {"detail": "Некоректне значення ваги."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if athlete_id:
            registrations = Registration.objects.filter(
                athlete_id=athlete_id, category__tournament_id=tournament_id
            )
        elif team_id:
            registrations = Registration.objects.filter(
                team_id=team_id, category__tournament_id=tournament_id
            )
        else:
            return Response(
                {"detail": "athlete_id або team_id обов'язковий."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not registrations.exists():
            return Response(
                {"detail": "Реєстрацій не знайдено."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Перевірка прав
        tournament = registrations.first().category.tournament
        if (
            request.user != tournament.organizer
            and request.user not in tournament.staff_members.all()
            and request.user.role != "admin"
        ):
            return Response(
                {"detail": f"Ви не маєте прав доступу до турніру '{tournament.title}'."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not tournament.weigh_in_required:
            return Response(
                {"detail": "Зважування не потрібне для цього турніру."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if tournament.status == "completed":
            return Response(
                {"detail": "Зважування заблоковано, оскільки турнір уже завершено."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        errors = []
        # Валідуємо всі спочатку
        for reg in registrations:
            category = reg.category
            if category.min_weight is not None and weight < float(category.min_weight):
                errors.append(
                    f"Вага {weight} кг менша за мінімально допустиму для "
                    f"категорії {category.name} ({category.min_weight} кг)."
                )
            if category.max_weight is not None and weight > float(category.max_weight):
                errors.append(
                    f"Вага {weight} кг більша за максимально допустиму для "
                    f"категорії {category.name} ({category.max_weight} кг)."
                )

        if errors:
            return Response(
                {"detail": " ".join(errors)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Зберігаємо
        for reg in registrations:
            reg.confirm_weigh_in(weight)

        # Broadcast updates
        from apps.common.broadcast import broadcast_registration_update

        for reg in registrations:
            broadcast_registration_update(reg)

        return Response(
            {"detail": f"Успішно зважено спортсмена. Оновлено {registrations.count()} категорій."},
            status=status.HTTP_200_OK,
        )

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

    @action(detail=False, methods=["post"], url_path="bulk_update_secretary")
    def bulk_update_secretary(self, request):
        """POST /api/registrations/bulk_update_secretary/
        Тіло: {
            "registration_ids": [1, 2, 3],
            "checked_in": true,             # опціонально
            "status": "confirmed",          # опціонально ("confirmed", "withdrawn")
            "payment_status": "paid"        # опціонально ("paid", "unpaid")
        }
        """
        if not request.user or not request.user.is_authenticated:
            return Response(
                {"detail": "Автентифікація обов'язкова."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        reg_ids = request.data.get("registration_ids", [])
        if not isinstance(reg_ids, list) or not reg_ids:
            return Response(
                {"detail": "registration_ids має бути списком."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        checked_in = request.data.get("checked_in")
        status_val = request.data.get("status")
        payment_status = request.data.get("payment_status")

        registrations = Registration.objects.filter(id__in=reg_ids).select_related(
            "category__tournament"
        )
        if not registrations.exists():
            return Response(
                {"detail": "Реєстрації не знайдено."}, status=status.HTTP_400_BAD_REQUEST
            )

        for reg in registrations:
            tournament = reg.category.tournament
            # Перевірка прав доступу: лише адмін, організатор або персонал турніру
            if (
                request.user != tournament.organizer
                and request.user not in tournament.staff_members.all()
                and request.user.role != "admin"
            ):
                return Response(
                    {"detail": f"Ви не маєте прав доступу до турніру '{tournament.title}'."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Перевірка блокування змін для онлайн-оплат
            if reg.payment_method == "online" and reg.payment_status == "paid":
                if payment_status is not None and payment_status != "paid":
                    return Response(
                        {"detail": f"Заборонено змінювати успішну онлайн-оплату для {reg}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            # Якщо статус змінюється на withdrawn, перевіряємо чи треба рефаунд
            if status_val == "withdrawn" and reg.status != "withdrawn":
                if reg.payment_status == "paid":
                    if tournament.refund_policy == "refundable":
                        if tournament.status not in [
                            Tournament.Status.ACTIVE,
                            Tournament.Status.COMPLETED,
                        ]:
                            if reg.payment_method == "online":
                                import uuid

                                from apps.billing.models import PaymentInvoice, Transaction
                                from apps.billing.services import MonobankService
                                from apps.billing.views import calculate_registration_fee

                                invoice = reg.payment_invoices.filter(
                                    status=PaymentInvoice.Status.PAID
                                ).first()
                                if invoice and invoice.invoice_id:
                                    try:
                                        base_fee = calculate_registration_fee(reg)
                                        if tournament.commission_payer == "buyer":
                                            price_to_refund = base_fee
                                        else:
                                            price_to_refund = int(base_fee * 0.95)

                                        if reg.athlete:
                                            name = (
                                                f"{reg.athlete.last_name} {reg.athlete.first_name}"
                                            )
                                        elif reg.team:
                                            name = reg.team.name
                                        else:
                                            name = ""
                                        ref_id = f"REF-{uuid.uuid4().hex[:8]}-{name}"[:100]

                                        MonobankService.refund_invoice(
                                            invoice_id=invoice.invoice_id,
                                            amount_uah=price_to_refund,
                                            ext_ref=ref_id,
                                        )

                                        Transaction.objects.create(
                                            invoice=invoice,
                                            user=invoice.user,
                                            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
                                            transaction_type=Transaction.Type.REFUND,
                                            amount=-price_to_refund,
                                            method=Transaction.Method.ONLINE,
                                            reference=ref_id,
                                            monobank_receipt_id=invoice.transactions.first().monobank_receipt_id
                                            if invoice.transactions.exists()
                                            else None,
                                            receipt_url=invoice.transactions.first().receipt_url
                                            if invoice.transactions.exists()
                                            else None,
                                        )
                                        reg.payment_status = "unpaid"
                                    except Exception:
                                        pass
                            elif reg.payment_method == "offline":
                                # Офлайн-оплата залишається зі статусом "paid" до
                                # ручного підтвердження повернення
                                pass

            # Оновлюємо поля
            if checked_in is not None:
                reg.checked_in = checked_in
            if status_val is not None:
                reg.status = status_val
            if payment_status is not None:
                # Оновлюємо тільки якщо оплата не заблокована
                if not (reg.payment_method == "online" and reg.payment_status == "paid"):
                    reg.payment_status = payment_status
                    if payment_status == "paid":
                        reg.payment_method = "offline"

            reg.save()
            from apps.common.broadcast import broadcast_registration_update

            broadcast_registration_update(reg)

        return Response(
            {"detail": f"Успішно оновлено {registrations.count()} реєстрацій."},
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="bulk_withdraw")
    def bulk_withdraw(self, request):
        """POST /api/registrations/bulk_withdraw/
        body: {
            "registration_ids": [1, 2, 3]
        }
        """
        if not request.user or not request.user.is_authenticated:
            return Response(
                {"detail": "Автентифікація обов'язкова."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        reg_ids = request.data.get("registration_ids", [])
        if not isinstance(reg_ids, list) or not reg_ids:
            return Response(
                {"detail": "registration_ids має бути списком."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        registrations = Registration.objects.filter(id__in=reg_ids).select_related(
            "category__tournament", "athlete", "team"
        )
        if not registrations.exists():
            return Response(
                {"detail": "Реєстрації не знайдено."}, status=status.HTTP_400_BAD_REQUEST
            )

        to_delete = []
        to_withdraw = []

        for reg in registrations:
            tournament = reg.category.tournament

            # Check permissions
            is_allowed = False
            if request.user.role == "admin":
                is_allowed = True
            elif (
                request.user == tournament.organizer
                or request.user in tournament.staff_members.all()
            ):
                is_allowed = True
            elif request.user.role == "coach":
                coach = None
                if reg.athlete:
                    coach = reg.athlete.coach
                elif reg.team:
                    coach = reg.team.coach
                if coach == request.user:
                    is_allowed = True

            if not is_allowed:
                return Response(
                    {"detail": f"Ви не маєте прав доступу для зняття {reg}."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Coaches cannot withdraw once the tournament starts or is completed
            if request.user.role == "coach" and tournament.status in [
                Tournament.Status.ACTIVE,
                Tournament.Status.COMPLETED,
            ]:
                return Response(
                    {"detail": "Тренер не може знімати спортсменів після початку турніру."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Determine delete vs withdraw
            if reg.payment_status != "paid":
                if request.user.role == "coach":
                    to_delete.append(reg)
                else:
                    to_withdraw.append(reg)
            else:
                to_withdraw.append(reg)

        # 1. Process deletions
        deleted_count = 0
        for reg in to_delete:
            reg.delete()
            deleted_count += 1

        # 2. Process withdrawals
        withdrawn_count = 0
        immediate_refund_regs = []

        for reg in to_withdraw:
            tournament = reg.category.tournament
            reg.status = "withdrawn"
            reg.save()  # Triggers walkover brackets logic
            withdrawn_count += 1

            if reg.payment_status == "paid" and reg.payment_method == "online":
                if tournament.refund_policy == "refundable":
                    if tournament.status not in [
                        Tournament.Status.ACTIVE,
                        Tournament.Status.COMPLETED,
                    ]:
                        immediate_refund_regs.append(reg)
            elif reg.payment_status == "paid" and reg.payment_method == "offline":
                # Офлайн-оплата залишається зі статусом "paid" (відображається
                # як "Знято (Оч. пов.)"), доки організатор не зафіксує повернення
                # готівки та не переведе платіж в "unpaid".
                pass

        # Process immediate refunds grouped by invoice
        if immediate_refund_regs:
            import uuid
            from collections import defaultdict

            from apps.billing.models import PaymentInvoice, Transaction
            from apps.billing.services import MonobankService
            from apps.billing.views import calculate_registration_fee

            invoice_groups = defaultdict(list)
            for reg in immediate_refund_regs:
                invoice = reg.payment_invoices.filter(status=PaymentInvoice.Status.PAID).first()
                if invoice and invoice.invoice_id:
                    invoice_groups[(reg.category.tournament, invoice)].append(reg)

            for (tournament, invoice), regs in invoice_groups.items():
                try:
                    total_refund = 0
                    for reg in regs:
                        base_fee = calculate_registration_fee(reg)
                        if tournament.commission_payer == "buyer":
                            total_refund += base_fee
                        else:
                            total_refund += int(base_fee * 0.95)

                    if total_refund > 0:
                        names_list = []
                        for r in regs:
                            if r.athlete:
                                names_list.append(f"{r.athlete.last_name} {r.athlete.first_name}")
                            elif r.team:
                                names_list.append(r.team.name)
                        names_str = ", ".join(names_list)
                        ref_id = f"REF-{uuid.uuid4().hex[:8]}-{names_str}"[:100]

                        MonobankService.refund_invoice(
                            invoice_id=invoice.invoice_id,
                            amount_uah=total_refund,
                            ext_ref=ref_id,
                        )
                        Transaction.objects.create(
                            invoice=invoice,
                            user=invoice.user,
                            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
                            transaction_type=Transaction.Type.REFUND,
                            amount=-total_refund,
                            method=Transaction.Method.ONLINE,
                            reference=ref_id,
                            monobank_receipt_id=invoice.transactions.first().monobank_receipt_id
                            if invoice.transactions.exists()
                            else None,
                            receipt_url=invoice.transactions.first().receipt_url
                            if invoice.transactions.exists()
                            else None,
                        )
                        for reg in regs:
                            reg.payment_status = "unpaid"
                            reg.save(update_fields=["payment_status"])
                except Exception:
                    pass

        # Trigger broadcasts for all modified/deleted
        from apps.common.broadcast import broadcast_registration_update

        for reg in to_withdraw:
            broadcast_registration_update(reg)

        return Response(
            {
                "detail": (
                    f"Успішно оновлено реєстрації: знято {withdrawn_count}, "
                    f"видалено {deleted_count}."
                )
            },
            status=status.HTTP_200_OK,
        )

    def _get_registrations_for_bulk(self, request):
        if not request.user or not request.user.is_authenticated:
            return None, Response(
                {"detail": "Автентифікація обов'язкова."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        reg_ids = request.data.get("registration_ids", [])
        if not isinstance(reg_ids, list) or not reg_ids:
            return None, Response(
                {"detail": "registration_ids має бути списком."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        registrations = Registration.objects.filter(id__in=reg_ids).select_related(
            "category__tournament", "athlete", "team"
        )
        if not registrations.exists():
            return None, Response(
                {"detail": "Реєстрації не знайдено."}, status=status.HTTP_400_BAD_REQUEST
            )

        return registrations, None

    def _is_staff_or_organizer(self, user, tournament):
        return (
            user.role == "admin"
            or user == tournament.organizer
            or user in tournament.staff_members.all()
        )

    @action(detail=False, methods=["post"], url_path="bulk_mark_offline_refunded")
    def bulk_mark_offline_refunded(self, request):
        """POST /api/registrations/bulk_mark_offline_refunded/"""
        registrations, err_resp = self._get_registrations_for_bulk(request)
        if err_resp:
            return err_resp

        updated_count = 0
        from apps.common.broadcast import broadcast_registration_update

        for reg in registrations:
            tournament = reg.category.tournament
            if not self._is_staff_or_organizer(request.user, tournament):
                return Response(
                    {"detail": f"Ви не маєте прав доступу для відмітки повернення для {reg}."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if (
                reg.status == "withdrawn"
                and reg.payment_method == "offline"
                and reg.payment_status == "paid"
                and reg.offline_refund_status == "none"
            ):
                reg.offline_refund_status = "pending"
                reg.save(update_fields=["offline_refund_status"])
                broadcast_registration_update(reg)
                updated_count += 1

        return Response(
            {
                "detail": (
                    f"Успішно позначено як повернуті {updated_count} реєстрацій "
                    f"(очікують підтвердження від тренера)."
                )
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="bulk_confirm_offline_refund_received")
    def bulk_confirm_offline_refund_received(self, request):
        """POST /api/registrations/bulk_confirm_offline_refund_received/"""
        registrations, err_resp = self._get_registrations_for_bulk(request)
        if err_resp:
            return err_resp

        updated_count = 0
        from apps.common.broadcast import broadcast_registration_update

        for reg in registrations:
            tournament = reg.category.tournament
            # Check permissions: coach or admin or organizer/staff
            is_allowed = self._is_staff_or_organizer(request.user, tournament)
            if not is_allowed and request.user.role == "coach":
                coach = None
                if reg.athlete:
                    coach = reg.athlete.coach
                elif reg.team:
                    coach = reg.team.coach
                if coach == request.user:
                    is_allowed = True

            if not is_allowed:
                return Response(
                    {"detail": f"Ви не маєте прав доступу для підтвердження отримання для {reg}."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if (
                reg.status == "withdrawn"
                and reg.payment_method == "offline"
                and reg.payment_status == "paid"
                and reg.offline_refund_status == "pending"
            ):
                reg.offline_refund_status = "confirmed"
                reg.payment_status = "unpaid"
                reg.save(update_fields=["offline_refund_status", "payment_status"])
                broadcast_registration_update(reg)
                updated_count += 1

        return Response(
            {
                "detail": (
                    f"Успішно підтверджено отримання повернення для {updated_count} реєстрацій."
                )
            },
            status=status.HTTP_200_OK,
        )
