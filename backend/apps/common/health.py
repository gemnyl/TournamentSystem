"""
Health-check endpoints.

GET /healthz/  — liveness probe: завжди повертає 200 {"status": "ok"}
GET /readyz/   — readiness probe: перевіряє БД і Redis; повертає 503 якщо щось не працює.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import OperationalError, connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def liveness(request):
    """Liveness probe — швидка відповідь без зовнішніх залежностей."""
    return JsonResponse({"status": "ok"})


def readiness(request):
    """
    Readiness probe — перевіряє готовність зовнішніх залежностей:
    - PostgreSQL: SELECT 1
    - Redis (через channel_layer): send/receive ping
    """
    errors: dict[str, str] = {}

    # --- Database check ---
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except OperationalError as exc:
        logger.error("readyz: database check failed: %s", exc)
        errors["database"] = str(exc)

    # --- Redis / channel layer check ---
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            raise RuntimeError("channel_layer is None — CHANNEL_LAYERS not configured")
        async_to_sync(channel_layer.send)(
            "healthz-ping",
            {"type": "healthz.ping"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("readyz: redis/channel_layer check failed: %s", exc)
        errors["redis"] = str(exc)

    if errors:
        body = {"status": "error", "errors": errors}
        return JsonResponse(body, status=503)

    return JsonResponse({"status": "ok"})
