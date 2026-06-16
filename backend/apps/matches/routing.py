"""WebSocket URL-маршрути для Django Channels."""

from django.urls import re_path

from apps.matches.consumers import MatchConsumer, TournamentConsumer

websocket_urlpatterns = [
    re_path(r"^ws/category/(?P<category_id>\d+)/$", MatchConsumer.as_asgi()),
    re_path(r"^ws/tournament/(?P<tournament_id>\d+)/$", TournamentConsumer.as_asgi()),
]
