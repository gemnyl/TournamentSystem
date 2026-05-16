"""
Views підсистеми поєдинків.

MatchViewSet:
    update_score     — POST /api/matches/{id}/update_score/
    add_warning      — POST /api/matches/{id}/add_warning/
    set_winner       — POST /api/matches/{id}/set_winner/
    bracket          — GET  /api/matches/bracket/?category={id}
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsJudge
from apps.matches.models import Match
from apps.matches.serializers import BracketNodeSerializer, MatchSerializer


def _push_match_update(match: Match):
    """Надсилає оновлений матч усім підписникам групи категорії через Channels."""
    channel_layer = get_channel_layer()
    group_name = f"category_{match.category_id}"
    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "match.update",
            "data": MatchSerializer(match).data,
        },
    )


class MatchViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Поєдинки — лише читання через стандартні list/retrieve.
    Усі зміни відбуваються через custom actions.
    """

    def get_queryset(self):
        qs = Match.objects.select_related(
            "category",
            "reg_first__athlete__club",
            "reg_second__athlete__club",
            "winner__athlete",
        )
        category_id = self.request.query_params.get("category")
        if category_id:
            qs = qs.filter(category_id=category_id)
        return qs.order_by("round_index", "match_order")

    def get_serializer_class(self):
        return MatchSerializer

    def get_permissions(self):
        if self.action in ("update_score", "add_warning", "set_winner"):
            return [IsJudge()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    # ------------------------------------------------------------------
    # Ігрові дії
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="update_score")
    def update_score(self, request, pk=None):
        """POST /api/matches/{id}/update_score/
        Тіло: {"participant": 1, "delta": 1}
        """
        match = self.get_object()
        participant = request.data.get("participant")
        delta = int(request.data.get("delta", 1))

        if participant not in (1, 2):
            return Response(
                {"detail": "participant має бути 1 або 2."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            match.update_score(participant, delta)
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)

        _push_match_update(match)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="add_warning")
    def add_warning(self, request, pk=None):
        """POST /api/matches/{id}/add_warning/
        Тіло: {"participant": 2}
        """
        match = self.get_object()
        participant = request.data.get("participant")

        if participant not in (1, 2):
            return Response(
                {"detail": "participant має бути 1 або 2."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            match.add_warning(participant)
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)

        _push_match_update(match)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="set_winner")
    def set_winner(self, request, pk=None):
        """POST /api/matches/{id}/set_winner/
        Тіло: {"winner_id": <registration_id>, "method": "ippon"}
        """
        match = self.get_object()
        winner_id = request.data.get("winner_id")
        method = request.data.get("method", Match.WinMethod.DECISION)

        # Знаходимо реєстрацію серед учасників матчу
        winner_reg = None
        for reg in (match.reg_first, match.reg_second):
            if reg and reg.id == winner_id:
                winner_reg = reg
                break

        if winner_reg is None:
            return Response(
                {"detail": "winner_id не відповідає жодному учаснику матчу."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if method not in Match.WinMethod.values:
            return Response(
                {"detail": f"Невідомий метод перемоги: {method}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            match.set_winner(winner_reg, method)
        except DjangoValidationError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)

        _push_match_update(match)
        return Response(MatchSerializer(match).data)

    # ------------------------------------------------------------------
    # Сітка категорії (список раундів)
    # ------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="bracket")
    def bracket(self, request):
        """GET /api/matches/bracket/?category={id}
        Повертає всі матчі категорії, згрупованих по раундах.
        Зручно для візуалізації сітки на фронтенді.
        """
        category_id = request.query_params.get("category")
        if not category_id:
            return Response(
                {"detail": "Параметр category є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        matches = (
            Match.objects.filter(
                category_id=category_id,
            )
            .select_related(
                "reg_first__athlete__club",
                "reg_second__athlete__club",
                "winner__athlete",
            )
            .order_by("round_index", "match_order")
        )

        # Групуємо по round_index
        rounds: dict[int, list] = {}
        for match in matches:
            rounds.setdefault(match.round_index, []).append(match)

        result = [
            {"round_index": round_idx, "matches": round_matches}
            for round_idx, round_matches in sorted(rounds.items())
        ]

        serializer = BracketNodeSerializer(result, many=True)
        return Response(serializer.data)
