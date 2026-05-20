from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from apps.tatamis.models import Tatami
from apps.tatamis.serializers import TatamiSerializer


class TatamiViewSet(viewsets.ModelViewSet):
    """
    GET  /api/tatamis/?tournament={id}  — список татамі турніру
    POST /api/tatamis/                  — створити (organizer)
    Детальні actions (assign_match, release, state) — Крок 2.
    """

    serializer_class = TatamiSerializer

    def get_queryset(self):
        qs = Tatami.objects.select_related("tournament", "current_match")
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(tournament_id=tournament_id)
        return qs

    def get_permissions(self):
        if self.action == "create":
            from apps.accounts.permissions import IsOrganizer

            return [IsOrganizer()]
        return [AllowAny()]
