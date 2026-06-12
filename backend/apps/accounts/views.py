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
from apps.accounts.permissions import IsOrganizer
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
        if self.action in ("list", "retrieve", "create"):
            return [AllowAny()]
        return [IsAdminUser()]


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """Список користувачів — тільки для адміністраторів та організаторів."""

    serializer_class = UserSerializer
    permission_classes = [IsOrganizer]
    from apps.common.pagination import OptionalPageNumberPagination

    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        qs = User.objects.select_related("club").all()
        role = self.request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)

        search = self.request.query_params.get("search")
        if search:
            from django.db.models import Q

            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
            )

        ids = self.request.query_params.get("ids")
        if ids:
            id_list = [int(x) for x in ids.split(",") if x.isdigit()]
            if id_list:
                qs = qs.filter(id__in=id_list)

        return qs


class VerifyPassView(APIView):
    """Ендпоінт для верифікації бейджів учасників за підписаним токеном."""

    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        token = request.query_params.get("token")
        if not token:
            return Response(
                {"detail": "Токен є обов'язковим для верифікації."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.core import signing

        signer = signing.Signer(salt="qr-verification")
        try:
            unsigned = signer.unsign(token)
            from django.db.models import Q

            from apps.tournaments.models import Registration
            from apps.tournaments.serializers import RegistrationSerializer

            if unsigned.startswith("reg:"):
                reg_id = int(unsigned.split(":")[1])

                try:
                    reg = Registration.objects.select_related(
                        "athlete", "athlete__club", "category", "category__tournament", "team"
                    ).get(id=reg_id)
                except Registration.DoesNotExist:
                    return Response(
                        {"detail": "Заявку на реєстрацію не знайдено."},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                other_regs = []
                if reg.athlete:
                    other_regs = (
                        Registration.objects.filter(
                            Q(athlete=reg.athlete) | Q(team__athletes=reg.athlete)
                        )
                        .select_related(
                            "athlete", "athlete__club", "category", "category__tournament", "team"
                        )
                        .exclude(id=reg.id)
                        .distinct()
                    )

                serializer = RegistrationSerializer(reg)
                data = serializer.data
                if other_regs:
                    data["other_registrations"] = RegistrationSerializer(other_regs, many=True).data
                return Response({"type": "registration", "data": data})

            elif unsigned.startswith("ath:"):
                ath_id = int(unsigned.split(":")[1])
                from apps.athletes.models import Athlete
                from apps.athletes.serializers import AthleteSerializer

                try:
                    ath = Athlete.objects.select_related("club").get(id=ath_id)
                except Athlete.DoesNotExist:
                    return Response(
                        {"detail": "Спортсмена не знайдено."},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                all_regs = (
                    Registration.objects.filter(Q(athlete=ath) | Q(team__athletes=ath))
                    .select_related(
                        "athlete", "athlete__club", "category", "category__tournament", "team"
                    )
                    .distinct()
                )

                serializer = AthleteSerializer(ath)
                data = serializer.data
                data["registrations"] = RegistrationSerializer(all_regs, many=True).data
                return Response({"type": "athlete", "data": data})

            else:
                return Response(
                    {"detail": "Невірний формат токена."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except signing.BadSignature:
            return Response(
                {"detail": "Недійсний підпис бейджа (можливо, токен було змінено чи підроблено)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# Create your views here.
