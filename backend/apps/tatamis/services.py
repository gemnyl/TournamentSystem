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
        from apps.common.broadcast import broadcast_tatami_state, broadcast_timer_state
        from apps.matches.models import Match

        match = Match.objects.select_related("category").get(pk=match_id)

        # If there's a currently ongoing match on this tatami, pause its timer
        # so ghost timer.state events stop reaching the scoreboard after the switch.
        prev_match = tatami.current_match
        if prev_match and prev_match.id != match.id:
            if prev_match.timer_status == Match.TimerStatus.RUNNING:
                from django.utils import timezone

                elapsed = prev_match.timer_elapsed_ms
                if prev_match.timer_started_at:
                    delta_ms = int(
                        (timezone.now() - prev_match.timer_started_at).total_seconds() * 1000
                    )
                    elapsed = min(
                        prev_match.timer_elapsed_ms + delta_ms, prev_match.timer_duration_ms
                    )
                prev_match.timer_status = Match.TimerStatus.PAUSED
                prev_match.timer_elapsed_ms = elapsed
                prev_match.timer_started_at = None
                prev_match.save(
                    update_fields=["timer_status", "timer_elapsed_ms", "timer_started_at"]
                )
                broadcast_timer_state(prev_match)

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
                        # For Swiss system, we only auto-finalize after the last round
                        is_swiss_final_round = True
                        if category.bracket_format == "swiss":
                            import math

                            n = category.registrations.filter(status="confirmed").count()
                            max_rounds = math.ceil(math.log2(n)) if n > 1 else 1
                            matches = list(category.matches.filter(parent_team_match__isnull=True))
                            current_round = max((m.round_index for m in matches), default=0)
                            if current_round < max_rounds:
                                is_swiss_final_round = False

                        if is_swiss_final_round:
                            try:
                                calculate_category_standings(category, persist=True)

                                # Broadcast to category channel so spectators get new results
                                from apps.common.broadcast import broadcast_category_results_update

                                broadcast_category_results_update(category.id)
                            except Exception:
                                import logging

                                logger = logging.getLogger(__name__)
                                logger.exception(
                                    f"Error auto-finalizing results for category {category.id}"
                                )
                        else:
                            if category.bracket_format == "swiss":
                                try:
                                    from apps.brackets.services import BracketGenerator

                                    BracketGenerator(category).generate_next_swiss_round()
                                except Exception:
                                    import logging

                                    logger = logging.getLogger(__name__)
                                    logger.exception(
                                        "Error auto-generating next Swiss round for "
                                        f"category {category.id}"
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
