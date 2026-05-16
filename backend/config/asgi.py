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
from apps.matches.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        # Стандартні HTTP-запити
        "http": django_asgi_app,
        # WebSocket-з'єднання: через AuthMiddlewareStack для доступу до request.user
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
