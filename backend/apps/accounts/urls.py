"""URL-маршрути підсистеми автентифікації та клубів."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import (
    ClubViewSet, LoginView, LogoutView, MeView, RegisterView, UserViewSet,
)

router = DefaultRouter()
router.register('clubs', ClubViewSet, basename='club')
router.register('users', UserViewSet, basename='user')

urlpatterns = [
    # Автентифікація
    path('login/',    LoginView.as_view(),    name='auth-login'),
    path('logout/',   LogoutView.as_view(),   name='auth-logout'),
    path('me/',       MeView.as_view(),       name='auth-me'),
    path('register/', RegisterView.as_view(), name='auth-register'),

    # Router-маршрути (clubs/, users/) монтуються у config/urls.py через /api/
    # Включаємо тут щоб router.urls діставалися через цей include
    path('', include(router.urls)),
]