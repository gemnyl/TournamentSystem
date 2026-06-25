"""URL-маршрути підсистеми автентифікації та клубів."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import (
    ChangePasswordView,
    ClubViewSet,
    ConfirmEmailView,
    ConfirmPasswordResetView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
    RequestPasswordResetView,
    ResendConfirmationView,
    RoleRequestViewSet,
    UserViewSet,
    VerifyPassView,
)

router = DefaultRouter()
router.register("clubs", ClubViewSet, basename="club")
router.register("users", UserViewSet, basename="user")
router.register("role-requests", RoleRequestViewSet, basename="role-request")

urlpatterns = [
    # Автентифікація
    path("login/", LoginView.as_view(), name="auth-login"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("confirm-email/", ConfirmEmailView.as_view(), name="auth-confirm-email"),
    path("resend-confirmation/", ResendConfirmationView.as_view(), name="auth-resend-confirmation"),
    path("change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("google-login/", GoogleLoginView.as_view(), name="auth-google-login"),
    path("verify-pass/", VerifyPassView.as_view(), name="verify-pass"),
    path(
        "password-reset-request/",
        RequestPasswordResetView.as_view(),
        name="auth-password-reset-request",
    ),
    path(
        "password-reset-confirm/",
        ConfirmPasswordResetView.as_view(),
        name="auth-password-reset-confirm",
    ),
    # Router-маршрути (clubs/, users/, role-requests/) монтуються у config/urls.py через /api/
    # Включаємо тут щоб router.urls діставалися через цей include
    path("", include(router.urls)),
]
