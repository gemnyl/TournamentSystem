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

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import login, logout
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Club, EmailConfirmationCode, RoleRequest, User
from apps.accounts.permissions import IsOrganizer
from apps.accounts.serializers import (
    ChangePasswordSerializer,
    ClubSerializer,
    LoginSerializer,
    RoleRequestSerializer,
    UserRegistrationSerializer,
    UserSerializer,
)


class LoginView(APIView):
    """POST /api/auth/login/ — автентифікація через сесію."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

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


def send_confirmation_code(user):
    # Видаляємо старі коди цього користувача
    EmailConfirmationCode.objects.filter(user=user).delete()

    # Генеруємо новий 6-значний код
    code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = timezone.now() + timedelta(minutes=15)

    EmailConfirmationCode.objects.create(user=user, code=code, expires_at=expires_at)

    # Відправляємо email (через консольний бекенд у консоль)
    subject = "Підтвердження реєстрації - TournamentApp"
    message = (
        f"Привіт, {user.first_name}!\n\n"
        f"Ваш код підтвердження реєстрації: {code}\n\n"
        "Код дійсний протягом 15 хвилин."
    )
    send_mail(
        subject,
        message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )


class MeView(APIView):
    """GET /api/auth/me/ — дані поточного автентифікованого користувача.
    PATCH /api/auth/me/ — оновлення профілю поточного користувача."""

    permission_classes = [IsAuthenticated]
    parser_classes = [
        JSONParser,
        MultiPartParser,
        FormParser,
    ]  # Підтримка завантаження фото та JSON

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        data = request.data.copy()
        # Очищуємо порожній photo стрінговий параметр, якщо він не є файлом
        if (
            "photo" in data
            and not request.FILES.get("photo")
            and (not data["photo"] or isinstance(data["photo"], str))
        ):
            data.pop("photo")

        serializer = UserSerializer(request.user, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


class RegisterView(APIView):
    """POST /api/auth/register/ — реєстрація нового облікового запису з кодом підтвердження."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Створення RoleRequest, якщо вибрана роль не є spectator
        requested_role = getattr(user, "_requested_role", User.Role.SPECTATOR)
        requested_club = getattr(user, "_requested_club", None)

        if requested_role in (User.Role.COACH, User.Role.JUDGE, User.Role.ORGANIZER):
            RoleRequest.objects.create(
                user=user,
                requested_role=requested_role,
                club=requested_club,
                referee_category=request.data.get("referee_category", ""),
                details=request.data.get("details", ""),
            )

        # Відправка коду активації
        try:
            send_confirmation_code(user)
        except Exception as e:
            # Друкуємо помилку в консоль, але не валимо реєстрацію
            print(f"Помилка при відправці коду: {e}")

        return Response(
            {
                "detail": "Акаунт створено. Код підтвердження надіслано на ваш email.",
                "email": user.email,
            },
            status=status.HTTP_201_CREATED,
        )


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


class ConfirmEmailView(APIView):
    """POST /api/auth/confirm-email/ — активація акаунта через код підтвердження."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        email = request.data.get("email")
        code = request.data.get("code")

        if not email or not code:
            return Response(
                {"detail": "Email та код є обов'язковими."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"detail": "Користувача з цим email не знайдено."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            confirmation = EmailConfirmationCode.objects.get(user=user)
        except EmailConfirmationCode.DoesNotExist:
            return Response(
                {"detail": "Код не знайдено або термін його дії закінчився."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if confirmation.expires_at < timezone.now():
            confirmation.delete()
            return Response(
                {"detail": "Термін дії коду закінчився. Будь ласка, запитайте новий код."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if confirmation.code != code:
            return Response(
                {"detail": "Невірний код підтвердження."}, status=status.HTTP_400_BAD_REQUEST
            )

        # Активуємо користувача
        user.is_active = True
        user.email_verified = True
        user.save()

        # Видаляємо використаний код
        confirmation.delete()

        # Логінимо користувача в сесію
        login(request, user)

        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class ResendConfirmationView(APIView):
    """POST /api/auth/resend-confirmation/ — повторна відправка коду активації."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"detail": "Email є обов'язковим полем."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"detail": "Користувача з цим email не знайдено."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.email_verified:
            return Response(
                {"detail": "Цей email вже підтверджено."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            send_confirmation_code(user)
        except Exception as e:
            return Response(
                {"detail": f"Не вдалося надіслати код: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {"detail": "Новий код підтвердження надіслано на ваш email."}, status=status.HTTP_200_OK
        )


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ — зміна пароля авторизованого користувача."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response(
                {"old_password": ["Невірний поточний пароль."]}, status=status.HTTP_400_BAD_REQUEST
            )

        user.set_password(serializer.validated_data["new_password"])
        user.save()

        # Оновлюємо сесію, щоб уникнути логауту
        from django.contrib.auth import update_session_auth_hash

        update_session_auth_hash(request, user)

        return Response({"detail": "Пароль успішно змінено."}, status=status.HTTP_200_OK)


class GoogleLoginView(APIView):
    """POST /api/auth/google-login/ — вхід через Google OAuth (з автоматичною активацією)."""

    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get("token")
        if not token:
            return Response(
                {"detail": "Токен Google є обов'язковим."}, status=status.HTTP_400_BAD_REQUEST
            )

        email = request.data.get("email")
        first_name = request.data.get("first_name", "")
        last_name = request.data.get("last_name", "")

        if not email:
            return Response({"detail": "Email є обов'язковим."}, status=status.HTTP_400_BAD_REQUEST)

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "first_name": first_name or "Google_User",
                "last_name": last_name or "User",
                "role": User.Role.SPECTATOR,
                "email_verified": True,
                "is_active": True,
                "name_locked": False,
            },
        )

        if created:
            user.set_unusable_password()
            user.save()
        else:
            if not user.is_active:
                user.is_active = True
            if not user.email_verified:
                user.email_verified = True
            user.save()

        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class RoleRequestViewSet(viewsets.ModelViewSet):
    """ViewSet для управління запитами на верифікацію ролей."""

    serializer_class = RoleRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if self.action == "list":
            return RoleRequest.objects.filter(user=user)
        if user.role in ("admin", "staff", "organizer"):
            return RoleRequest.objects.all()
        return RoleRequest.objects.filter(user=user)

    def perform_create(self, serializer):
        user = self.request.user
        requested_role = serializer.validated_data["requested_role"]

        if RoleRequest.objects.filter(
            user=user, requested_role=requested_role, status="pending"
        ).exists():
            from rest_framework.exceptions import ValidationError

            raise ValidationError("Запит на цю роль вже очікує підтвердження.")

        serializer.save(user=user)

    @action(detail=False, methods=["get"])
    def pending(self, request):
        """GET /api/auth/role-requests/pending/ — перегляд усіх очікуючих заявок."""
        # Тільки організатори та адміни можуть бачити очікуючі заявки
        if request.user.role not in ("admin", "staff", "organizer"):
            return Response({"detail": "Доступ заборонено."}, status=status.HTTP_403_FORBIDDEN)

        queryset = RoleRequest.objects.filter(status="pending")
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """POST /api/auth/role-requests/<id>/review/ — схвалення або відхилення заявки."""
        if request.user.role not in ("admin", "staff", "organizer"):
            return Response(
                {"detail": "Тільки персонал або організатори можуть перевіряти заявки."},
                status=status.HTTP_403_FORBIDDEN,
            )

        role_request = self.get_object()
        if role_request.status != "pending":
            return Response(
                {"detail": "Цей запит вже було розглянуто."}, status=status.HTTP_400_BAD_REQUEST
            )

        new_status = request.data.get("status")
        review_notes = request.data.get("review_notes", "")

        if new_status not in ("approved", "rejected"):
            return Response(
                {"detail": "Статус має бути 'approved' або 'rejected'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role_request.status = new_status
        role_request.review_notes = review_notes
        role_request.reviewed_at = timezone.now()
        role_request.reviewed_by = request.user
        role_request.save()

        if new_status == "approved":
            user = role_request.user
            user.role = role_request.requested_role
            if role_request.requested_role == User.Role.COACH and role_request.club:
                user.club = role_request.club
            user.save()

        return Response(RoleRequestSerializer(role_request).data, status=status.HTTP_200_OK)


# Create your views here.
