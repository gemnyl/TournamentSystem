from django.urls import re_path

from apps.tatamis.consumers import TatamiConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/tournament/(?P<tournament_id>\d+)/tatami/(?P<tatami_number>\d+)/$",
        TatamiConsumer.as_asgi(),
    ),
]
