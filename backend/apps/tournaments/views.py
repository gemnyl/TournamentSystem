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
        if self.action in ("create", "update", "partial_update", "destroy", "generate_bracket"):
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
