import time

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

MATCH_EVENT_TYPE = "match.event"


def _tatami_group(match) -> str | None:
    if not match.tatami_id:
        return None
    t = match.tatami
    return f"tatami_{t.tournament_id}_{t.number}"


def broadcast_match_event(match, event) -> None:
    """Fan-out в category group + tatami group (якщо є)."""
    from apps.matches.serializers import MatchSerializer

    channel_layer = get_channel_layer()
    payload = {
        "type": MATCH_EVENT_TYPE,
        "match_id": match.id,
        "event": {
            "sequence": event.sequence,
            "event_type": event.event_type,
            "payload": event.payload,
        },
        "match": MatchSerializer(match).data,
    }
    async_to_sync(channel_layer.group_send)(f"category_{match.category_id}", payload)
    group = _tatami_group(match)
    if group:
        async_to_sync(channel_layer.group_send)(group, payload)


def broadcast_timer_state(match) -> None:
    group = _tatami_group(match)
    if not group:
        return
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        group,
        {
            "type": "timer.state",
            "match_id": match.id,
            "server_ts_ms": int(time.time() * 1000),
            "state": {
                "status": match.timer_status,
                "started_at_ms": (
                    int(match.timer_started_at.timestamp() * 1000)
                    if match.timer_started_at
                    else None
                ),
                "elapsed_ms": match.timer_elapsed_ms,
                "duration_ms": match.timer_duration_ms,
            },
        },
    )


def broadcast_tatami_state(tatami) -> None:
    """Broadcast при assign_match та release — оновлює Scoreboard і оператора."""
    from apps.matches.serializers import MatchSerializer
    from apps.tatamis.serializers import TatamiSerializer

    channel_layer = get_channel_layer()
    group = f"tatami_{tatami.tournament_id}_{tatami.number}"
    current_match = tatami.current_match
    async_to_sync(channel_layer.group_send)(
        group,
        {
            "type": "tatami.state",
            "server_ts_ms": int(time.time() * 1000),
            "tatami": TatamiSerializer(tatami).data,
            "current_match": (MatchSerializer(current_match).data if current_match else None),
        },
    )


def broadcast_match_update(match) -> None:
    """Оновлення поєдинку для category group + tatami group (якщо є) без події."""
    from apps.matches.serializers import MatchSerializer

    channel_layer = get_channel_layer()
    payload = {
        "type": MATCH_EVENT_TYPE,
        "match_id": match.id,
        "event": {
            "sequence": 0,
            "event_type": "update",
            "payload": {},
        },
        "match": MatchSerializer(match).data,
    }
    async_to_sync(channel_layer.group_send)(f"category_{match.category_id}", payload)
    group = _tatami_group(match)
    if group:
        async_to_sync(channel_layer.group_send)(group, payload)


def broadcast_category_results_update(category_id: int) -> None:
    """Broadcast to category channel to trigger spectator/operator updates when results change."""
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"category_{category_id}",
        {
            "type": MATCH_EVENT_TYPE,
            "match_id": 0,
            "event": {
                "sequence": 0,
                "event_type": "results_update",
                "payload": {},
            },
            "match": None,
        },
    )


def broadcast_registration_update(registration) -> None:
    """Broadcast registration update to the tournament group."""
    from apps.tournaments.serializers import RegistrationSerializer

    channel_layer = get_channel_layer()
    tournament_id = registration.category.tournament_id
    payload = {
        "type": "registration.update",
        "registration": RegistrationSerializer(registration).data,
    }
    async_to_sync(channel_layer.group_send)(f"tournament_{tournament_id}", payload)
