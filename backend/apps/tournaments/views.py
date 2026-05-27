"""
Views турнірного рівня.

TournamentViewSet  — повний CRUD + дії open_registration / start / complete
CategoryViewSet    — CRUD категорій + generate_bracket
RegistrationViewSet— CRUD реєстрацій + confirm_weigh_in
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsOrganizer
from apps.brackets.services import BracketGenerator
from apps.matches.serializers import MatchSerializer
from apps.tournaments.models import Category, Registration, Tournament
from apps.tournaments.serializers import (
    CategorySerializer,
    RegistrationSerializer,
    TournamentDetailSerializer,
    TournamentSerializer,
)


class TournamentViewSet(viewsets.ModelViewSet):
    """Турніри: список, деталі, CRUD та управління станом."""

    queryset = Tournament.objects.select_related("organizer").prefetch_related("categories").all()

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

    @action(detail=True, methods=["post"], url_path="generate_all_brackets")
    def generate_all_brackets(self, request, pk=None):
        """POST /api/tournaments/{id}/generate_all_brackets/"""
        tournament = self.get_object()
        categories = tournament.categories.all()

        round_robin_min = int(request.data.get("round_robin_min", 2))
        round_robin_max = int(request.data.get("round_robin_max", 5))
        single_elimination_min = int(request.data.get("single_elimination_min", 6))
        single_elimination_max = int(request.data.get("single_elimination_max", 32))

        generated_count = 0
        errors = []
        for cat in categories:
            if cat.matches.exists():
                continue
            confirmed_count = cat.registrations.filter(status=Registration.Status.CONFIRMED).count()
            if confirmed_count < 2:
                continue

            if round_robin_min <= confirmed_count <= round_robin_max:
                cat.bracket_format = Category.BracketFormat.ROUND_ROBIN
                cat.save(update_fields=["bracket_format"])
            elif single_elimination_min <= confirmed_count <= single_elimination_max:
                cat.bracket_format = Category.BracketFormat.SINGLE_ELIMINATION
                cat.save(update_fields=["bracket_format"])

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
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    def perform_create(self, serializer):
        # tournament передається у тілі запиту; перевіряємо, що організатор — власник
        tournament = serializer.validated_data["tournament"]
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
            category.save(update_fields=["bracket_format"])

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
        return Response(
            {"detail": f"Усі матчі категорії успішно призначено на татамі №{tatami.number}."},
            status=status.HTTP_200_OK,
        )


class RegistrationViewSet(viewsets.ModelViewSet):
    """Реєстрації спортсменів на категорії."""

    serializer_class = RegistrationSerializer

    def get_queryset(self):
        qs = Registration.objects.select_related("athlete", "athlete__club", "category")
        # Фільтр за категорією (опціонально)
        category_id = self.request.query_params.get("category")
        if category_id:
            qs = qs.filter(category_id=category_id)
        return qs

    def get_permissions(self):
        if self.action == "confirm_weigh_in":
            return [IsOrganizer()]
        if self.action in ("create", "destroy"):
            from apps.accounts.permissions import IsCoach

            return [IsCoach()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    @action(detail=True, methods=["post"], url_path="confirm_weigh_in")
    def confirm_weigh_in(self, request, pk=None):
        """POST /api/registrations/{id}/confirm_weigh_in/
        Тіло: {"weight": 74.5}
        """
        registration = self.get_object()
        weight = request.data.get("weight")
        if weight is None:
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
        return Response(RegistrationSerializer(registration).data)
