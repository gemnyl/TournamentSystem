import time

from apps.tatamis.models import Tatami


class TatamiService:
    @staticmethod
    def get_snapshot(tournament_id: int, tatami_number: int) -> dict:
        from apps.matches.serializers import MatchSerializer
        from apps.tatamis.serializers import TatamiSerializer

        tatami = Tatami.objects.select_related("tournament", "current_match__category").get(
            tournament_id=tournament_id, number=tatami_number
        )

        current_match = tatami.current_match
        if current_match and current_match.tatami_id != tatami.id:
            # Self-healing: clear the ghost current match
            tatami.current_match = None
            tatami.save(update_fields=["current_match"])
            current_match = None

        return {
            "tatami": TatamiSerializer(tatami).data,
            "server_ts_ms": int(time.time() * 1000),
            "current_match": MatchSerializer(current_match).data if current_match else None,
        }

    @staticmethod
    def get_current_match(tournament_id: int, tatami_number: int):
        try:
            tatami = Tatami.objects.select_related("current_match__category").get(
                tournament_id=tournament_id, number=tatami_number
            )
            current_match = tatami.current_match
            if current_match and current_match.tatami_id != tatami.id:
                # Self-healing
                tatami.current_match = None
                tatami.save(update_fields=["current_match"])
                current_match = None
            return current_match
        except Tatami.DoesNotExist:
            return None

    @staticmethod
    def assign_match(tatami: Tatami, match_id: int) -> None:
        from apps.common.broadcast import broadcast_tatami_state
        from apps.matches.models import Match

        match = Match.objects.select_related("category").get(pk=match_id)

        # Clear this match from any other tatami's current_match
        other_tatamis = Tatami.objects.filter(current_match=match).exclude(id=tatami.id)
        for ot in other_tatamis:
            ot.current_match = None
            ot.save(update_fields=["current_match"])
            broadcast_tatami_state(ot)

        # Встановлюємо двосторонній зв'язок: match.tatami потрібен для broadcast
        # (broadcast_match_event використовує _tatami_group(match), яка читає match.tatami_id)
        match.tatami = tatami
        match.save(update_fields=["tatami"])

        tatami.current_match = match
        tatami.active_results_category = None
        tatami.save(update_fields=["current_match", "active_results_category"])
        broadcast_tatami_state(tatami)

    @staticmethod
    def release(tatami: Tatami) -> None:
        from apps.common.broadcast import broadcast_tatami_state
        from apps.tournaments.services import calculate_category_standings

        # match.tatami НЕ обнуляємо — зберігаємо інформацію де проходив матч
        active_match = tatami.current_match
        if active_match:
            category = active_match.category
            if category:
                # Check if all matches in this category are completed
                if not category.matches.exclude(status="completed").exists():
                    # Check if results are not already finalized
                    if not category.registrations.filter(place__isnull=False).exists():
                        try:
                            calculate_category_standings(category, persist=True)

                            # Broadcast to category channel so spectators get new results
                            from asgiref.sync import async_to_sync
                            from channels.layers import get_channel_layer

                            channel_layer = get_channel_layer()
                            async_to_sync(channel_layer.group_send)(
                                f"category_{category.id}",
                                {
                                    "type": "match.event",
                                    "match_id": 0,
                                    "event": {
                                        "sequence": 0,
                                        "event_type": "results_update",
                                        "payload": {},
                                    },
                                    "match": None,
                                },
                            )
                        except Exception:
                            import logging

                            logger = logging.getLogger(__name__)
                            logger.exception(
                                f"Error auto-finalizing results for category {category.id}"
                            )

        tatami.current_match = None
        tatami.save(update_fields=["current_match"])
        broadcast_tatami_state(tatami)

    @staticmethod
    def set_active_results_category(tatami: Tatami, category_id: int | None) -> None:
        from apps.common.broadcast import broadcast_tatami_state
        from apps.tournaments.models import Category

        if category_id is not None:
            category = Category.objects.get(pk=category_id)
            tatami.active_results_category = category
            tatami.current_match = None  # Clear active match if projecting standings
        else:
            tatami.active_results_category = None

        tatami.save(update_fields=["current_match", "active_results_category"])
        broadcast_tatami_state(tatami)
