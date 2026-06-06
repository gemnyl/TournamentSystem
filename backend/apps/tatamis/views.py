import time

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.matches.serializers import MatchSerializer
from apps.tatamis.models import Tatami
from apps.tatamis.serializers import TatamiSerializer
from apps.tatamis.services import TatamiService


class TatamiViewSet(viewsets.ModelViewSet):
    """
    GET  /api/tatamis/?tournament={id}   — список татамі турніру
    POST /api/tatamis/                   — створити (organizer)
    POST /api/tatamis/{id}/assign_match/ — body: {match_id: int}
    POST /api/tatamis/{id}/release/      — current_match = None
    GET  /api/tatamis/{id}/state/        — snapshot для reconnect
    """

    serializer_class = TatamiSerializer

    def get_queryset(self):
        qs = Tatami.objects.select_related("tournament", "current_match__category")
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(tournament_id=tournament_id)
        return qs

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            from apps.accounts.permissions import IsOrganizer

            return [IsOrganizer()]
        if self.action in ("assign_match", "release", "set_active_results_category"):
            from apps.accounts.permissions import IsJudgeOrOrganizer

            return [IsJudgeOrOrganizer()]
        return [AllowAny()]

    @action(detail=True, methods=["post"], url_path="assign_match")
    def assign_match(self, request, pk=None):
        tatami = self.get_object()
        if request.user.is_authenticated and request.user.role == "judge":
            if tatami.assigned_judge_id != request.user.id:
                return Response(
                    {"detail": "Ви не закріплені за цим татамі!"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        match_id = request.data.get("match_id")
        if not match_id:
            return Response(
                {"detail": "Поле 'match_id' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            TatamiService.assign_match(tatami, int(match_id))
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        tatami.refresh_from_db()
        return Response(TatamiSerializer(tatami).data)

    @action(detail=True, methods=["post"], url_path="release")
    def release(self, request, pk=None):
        tatami = self.get_object()
        if request.user.is_authenticated and request.user.role == "judge":
            if tatami.assigned_judge_id != request.user.id:
                return Response(
                    {"detail": "Ви не закріплені за цим татамі!"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        TatamiService.release(tatami)
        tatami.refresh_from_db()
        return Response(TatamiSerializer(tatami).data)

    @action(detail=True, methods=["post"], url_path="set_active_results_category")
    def set_active_results_category(self, request, pk=None):
        tatami = self.get_object()
        if request.user.is_authenticated and request.user.role == "judge":
            if tatami.assigned_judge_id != request.user.id:
                return Response(
                    {"detail": "Ви не закріплені за цим татамі!"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        category_id = request.data.get("category_id")
        try:
            TatamiService.set_active_results_category(
                tatami, int(category_id) if category_id is not None else None
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        tatami.refresh_from_db()
        return Response(TatamiSerializer(tatami).data)

    @action(detail=True, methods=["get"], url_path="state")
    def state(self, request, pk=None):
        tatami = self.get_object()
        if request.user.is_authenticated and request.user.role == "judge":
            if tatami.assigned_judge_id != request.user.id:
                return Response(
                    {"detail": "Ви не закріплені за цим татамі!"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        current_match = tatami.current_match
        return Response(
            {
                "tatami": TatamiSerializer(tatami).data,
                "server_ts_ms": int(time.time() * 1000),
                "current_match": (MatchSerializer(current_match).data if current_match else None),
            }
        )
