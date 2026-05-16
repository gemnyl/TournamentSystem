"""
Views підсистеми облікових записів.

Ендпоінти:
    POST /api/auth/login/       — логін (сесія)
    POST /api/auth/logout/      — вихід
    GET  /api/auth/me/          — профіль поточного користувача
    POST /api/auth/register/    — реєстрація нового користувача
    GET  /api/clubs/            — список клубів
    GET  /api/users/            — список користувачів (тільки для admin)
"""

from django.contrib.auth import login, logout
from rest_framework import status, viewsets
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Club, User
from apps.accounts.serializers import (
    ClubSerializer,
    LoginSerializer,
    UserRegistrationSerializer,
    UserSerializer,
)


class LoginView(APIView):
    """POST /api/auth/login/ — автентифікація через сесію."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """POST /api/auth/logout/ — завершення сесії."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"detail": "Сесію завершено."}, status=status.HTTP_200_OK)


class MeView(APIView):
    """GET /api/auth/me/ — дані поточного автентифікованого користувача."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class RegisterView(APIView):
    """POST /api/auth/register/ — реєстрація нового облікового запису."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class ClubViewSet(viewsets.ModelViewSet):
    """CRUD для клубів. Список — публічний; зміна — лише admin."""

    queryset = Club.objects.all()
    serializer_class = ClubSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [IsAdminUser()]


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """Список користувачів — тільки для адміністраторів."""

    queryset = User.objects.select_related("club").all()
    serializer_class = UserSerializer
    permission_classes = [IsAdminUser]


# Create your views here.
