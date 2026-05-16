"""WebSocket URL-маршрути для Django Channels."""

from django.urls import re_path

from apps.matches.consumers import MatchConsumer

websocket_urlpatterns = [
    re_path(r"^ws/category/(?P<category_id>\d+)/$", MatchConsumer.as_asgi()),
]
