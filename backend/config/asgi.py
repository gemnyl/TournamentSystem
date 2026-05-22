"""
ASGI-точка входу.

Маршрутизація:
    HTTP  → стандартний Django ASGI handler
    WS    → ProtocolTypeRouter → URLRouter (apps/matches/routing.py)
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Django ASGI application (HTTP)
django_asgi_app = get_asgi_application()

# Імпортуємо WebSocket-маршрути після ініціалізації Django
from apps.matches.routing import websocket_urlpatterns as matches_ws  # noqa: E402
from apps.tatamis.routing import websocket_urlpatterns as tatamis_ws  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(matches_ws + tatamis_ws)),
    }
)
