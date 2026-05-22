"""
Views підсистеми поєдинків.

MatchViewSet:
    update_score  — POST /api/matches/{id}/update_score/   body: {corner, action_key}
    set_senshu    — POST /api/matches/{id}/set_senshu/     body: {value}
    set_winner    — POST /api/matches/{id}/set_winner/     body: {corner, win_method}
    bracket       — GET  /api/matches/bracket/?category={id}
"""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsJudge
from apps.common.broadcast import broadcast_match_event
from apps.matches.models import Match
from apps.matches.serializers import BracketNodeSerializer, MatchSerializer
from apps.matches.services.match_service import MatchService


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
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(category__tournament_id=tournament_id)
        return qs.order_by("round_index", "match_order")

    def get_serializer_class(self):
        return MatchSerializer

    def get_permissions(self):
        judge_actions = (
            "update_score",
            "set_senshu",
            "set_winner",
            "timer_start",
            "timer_pause",
            "timer_resume",
            "timer_reset",
            "timer_set_duration",
            "timer_add_time",
        )
        if self.action in judge_actions:
            return [IsJudge()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    # ------------------------------------------------------------------
    # Ігрові дії
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="update_score")
    def update_score(self, request, pk=None):
        """POST /api/matches/{id}/update_score/
        Тіло: {"corner": "aka"|"ao", "action_key": "yuko"|"wazaari"|"ippon"|"penalty"|...}
        """
        match = self.get_object()
        corner = request.data.get("corner")
        action_key = request.data.get("action_key")

        if not corner or not action_key:
            return Response(
                {"detail": "Поля 'corner' та 'action_key' є обов'язковими."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            svc = MatchService(match)
            svc.apply_score(corner, action_key, judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        last_event = match.events.order_by("-sequence").first()
        broadcast_match_event(match, last_event)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="set_senshu")
    def set_senshu(self, request, pk=None):
        """POST /api/matches/{id}/set_senshu/
        Тіло: {"value": "aka"|"ao"|"none"}
        """
        match = self.get_object()
        value = request.data.get("value")

        if value is None:
            return Response(
                {"detail": "Поле 'value' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            svc = MatchService(match)
            svc.set_senshu(value, judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        last_event = match.events.order_by("-sequence").first()
        broadcast_match_event(match, last_event)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="set_winner")
    def set_winner(self, request, pk=None):
        """POST /api/matches/{id}/set_winner/
        Тіло: {"corner": "aka"|"ao", "win_method": "hantei"|"hansoku"|"kiken"|...}
        """
        match = self.get_object()
        corner = request.data.get("corner")
        win_method = request.data.get("win_method", Match.WinMethod.DECISION)

        if not corner:
            return Response(
                {"detail": "Поле 'corner' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            svc = MatchService(match)
            svc.set_winner(corner, win_method, judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        last_event = match.events.order_by("-sequence").first()
        broadcast_match_event(match, last_event)
        return Response(MatchSerializer(match).data)

    # ------------------------------------------------------------------
    # Сітка категорії (список раундів)
    # ------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="bracket")
    def bracket(self, request):
        """GET /api/matches/bracket/?category={id}
        Повертає всі матчі категорії, згрупованих по раундах.
        """
        category_id = request.query_params.get("category")
        if not category_id:
            return Response(
                {"detail": "Параметр category є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        matches = (
            Match.objects.filter(category_id=category_id)
            .select_related(
                "reg_first__athlete__club",
                "reg_second__athlete__club",
                "winner__athlete",
            )
            .order_by("round_index", "match_order")
        )

        rounds: dict[int, list] = {}
        for match in matches:
            rounds.setdefault(match.round_index, []).append(match)

        result = [
            {"round_index": round_idx, "matches": round_matches}
            for round_idx, round_matches in sorted(rounds.items())
        ]

        serializer = BracketNodeSerializer(result, many=True)
        return Response(serializer.data)

    # ------------------------------------------------------------------
    # Таймер
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="timer/start")
    def timer_start(self, request, pk=None):
        match = self.get_object()
        try:
            MatchService(match).timer_start(judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="timer/pause")
    def timer_pause(self, request, pk=None):
        match = self.get_object()
        try:
            MatchService(match).timer_pause(judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="timer/resume")
    def timer_resume(self, request, pk=None):
        match = self.get_object()
        try:
            MatchService(match).timer_resume(judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="timer/reset")
    def timer_reset(self, request, pk=None):
        match = self.get_object()
        MatchService(match).timer_reset(judge=request.user)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="timer/set_duration")
    def timer_set_duration(self, request, pk=None):
        match = self.get_object()
        duration_ms = request.data.get("duration_ms")
        if duration_ms is None:
            return Response(
                {"detail": "Поле 'duration_ms' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            MatchService(match).timer_set_duration(int(duration_ms), judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MatchSerializer(match).data)

    @action(detail=True, methods=["post"], url_path="timer/add_time")
    def timer_add_time(self, request, pk=None):
        match = self.get_object()
        delta_ms = request.data.get("delta_ms")
        if delta_ms is None:
            return Response(
                {"detail": "Поле 'delta_ms' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            MatchService(match).timer_add_time(int(delta_ms), judge=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MatchSerializer(match).data)
