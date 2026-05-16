"""URL-маршрути турнірної підсистеми."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.tournaments.views import CategoryViewSet, RegistrationViewSet, TournamentViewSet

router = DefaultRouter()
router.register("tournaments", TournamentViewSet, basename="tournament")
router.register("categories", CategoryViewSet, basename="category")
router.register("registrations", RegistrationViewSet, basename="registration")

urlpatterns = [
    path("", include(router.urls)),
]
