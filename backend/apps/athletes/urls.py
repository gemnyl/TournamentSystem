"""URL-маршрути для спортсменів."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.athletes.views import AthleteViewSet, TeamViewSet

router = DefaultRouter()
router.register("athletes", AthleteViewSet, basename="athlete")
router.register("teams", TeamViewSet, basename="team")

urlpatterns = [
    path("", include(router.urls)),
]
