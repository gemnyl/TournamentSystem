"""URL-маршрути підсистеми поєдинків."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.matches.views import MatchViewSet

router = DefaultRouter()
router.register('matches', MatchViewSet, basename='match')

urlpatterns = [
    path('', include(router.urls)),
]