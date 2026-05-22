import time

from apps.tatamis.models import Tatami


class TatamiService:
    @staticmethod
    def get_snapshot(tournament_id: int, tatami_number: int) -> dict:
        from apps.matches.serializers import MatchSerializer
        from apps.tatamis.serializers import TatamiSerializer

        tatami = Tatami.objects.select_related("tournament", "current_match").get(
            tournament_id=tournament_id, number=tatami_number
        )

        current_match = tatami.current_match
        return {
            "tatami": TatamiSerializer(tatami).data,
            "server_ts_ms": int(time.time() * 1000),
            "current_match": MatchSerializer(current_match).data if current_match else None,
        }

    @staticmethod
    def get_current_match(tournament_id: int, tatami_number: int):
        try:
            tatami = Tatami.objects.select_related("current_match").get(
                tournament_id=tournament_id, number=tatami_number
            )
            return tatami.current_match
        except Tatami.DoesNotExist:
            return None

    @staticmethod
    def assign_match(tatami: Tatami, match_id: int) -> None:
        from apps.common.broadcast import broadcast_tatami_state
        from apps.matches.models import Match

        match = Match.objects.get(pk=match_id)
        tatami.current_match = match
        tatami.save(update_fields=["current_match"])
        broadcast_tatami_state(tatami)

    @staticmethod
    def release(tatami: Tatami) -> None:
        from apps.common.broadcast import broadcast_tatami_state

        tatami.current_match = None
        tatami.save(update_fields=["current_match"])
        broadcast_tatami_state(tatami)
