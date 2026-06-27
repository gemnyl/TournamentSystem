"""
Серіалайзери підсистеми автентифікації та організаційної структури.
"""

from django.contrib.auth import authenticate
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.accounts.models import Club, RoleRequest, User

PASSWORD_KEY = "password"  # noqa: S105 # NOSONAR


class ClubSerializer(serializers.ModelSerializer):
    """Серіалайзер спортивного клубу."""

    class Meta:
        model = Club
        fields = ["id", "name", "region"]


class UserSerializer(serializers.ModelSerializer):
    """Читання та повне редагування профілю користувача."""

    club = ClubSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "patronymic",
            "full_name",
            "role",
            "club",
            "photo",
            "phone",
            "birth_date",
            "gender",
            "skill_level",
            "referee_category",
            "email_verified",
            "date_joined",
            "name_locked",
            "is_club_leader",
            "credit_limit",
        ]
        read_only_fields = [
            "email",
            "role",
            "club",
            "email_verified",
            "date_joined",
            "name_locked",
            "is_club_leader",
            "credit_limit",
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()

    def get_fields(self):
        fields = super().get_fields()
        # Якщо ім'я вже заблоковано, робимо поля ПІБ read-only
        if self.instance and getattr(self.instance, "name_locked", False):
            if "first_name" in fields:
                fields["first_name"].read_only = True
            if "last_name" in fields:
                fields["last_name"].read_only = True
            if "patronymic" in fields:
                fields["patronymic"].read_only = True
        return fields

    def update(self, instance, validated_data):
        # Перевіряємо, чи є оновлення імені
        has_name_updates = any(
            x in validated_data for x in ["first_name", "last_name", "patronymic"]
        )
        # Блокуємо ім'я після першого заповнення (якщо воно не було заблоковане)
        if not instance.name_locked and has_name_updates:
            new_first_name = validated_data.get("first_name", instance.first_name)
            new_last_name = validated_data.get("last_name", instance.last_name)
            # Якщо ім'я змінили з дефолтного гуглівського і заповнили прізвище — блокуємо
            if new_first_name and new_last_name and new_first_name != "Google_User":
                instance.name_locked = True

        return super().update(instance, validated_data)


class UserPublicSerializer(serializers.ModelSerializer):
    """Публічний профіль користувача (обмежений набір безпечних полів)."""

    club = ClubSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "patronymic",
            "full_name",
            "role",
            "club",
            "photo",
            "skill_level",
            "referee_category",
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()


class UserRoleRequestSerializer(serializers.ModelSerializer):
    """Профіль користувача для заявок на роль (включає контакти)."""

    club = ClubSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "patronymic",
            "full_name",
            "role",
            "club",
            "photo",
            "skill_level",
            "referee_category",
            "email",
            "phone",
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()


class UserRegistrationSerializer(serializers.ModelSerializer):
    """Реєстрація нового облікового запису."""

    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        queryset=Club.objects.all(),
        source="club",
        required=False,
        allow_null=True,
    )

    class Meta:
        model = User
        fields = [
            "email",
            "first_name",
            "last_name",
            "patronymic",
            "role",
            "club_id",
            "password",
            "password_confirm",
            "phone",
            "birth_date",
            "gender",
            "skill_level",
            "referee_category",
        ]

    def validate(self, attrs):
        if attrs[PASSWORD_KEY] != attrs.pop("password_confirm"):  # noqa: S105 # NOSONAR
            raise serializers.ValidationError({"password_confirm": "Паролі не співпадають."})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop(PASSWORD_KEY)
        # При реєстрації роль користувача спочатку SPECTATOR
        requested_role = validated_data.get("role", User.Role.SPECTATOR)
        validated_data["role"] = User.Role.SPECTATOR

        # Клуб не призначаємо одразу
        club = validated_data.pop("club", None)

        user = User(**validated_data)
        user.set_password(password)
        user.is_active = False
        user.email_verified = False
        user.name_locked = True  # Для звичайної реєстрації блокуємо ім'я одразу
        user.save()

        # Кешуємо для View
        user._requested_role = requested_role
        user._requested_club = club

        return user


class LoginSerializer(serializers.Serializer):
    """Серіалайзер для логіну (email + пароль)."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["email"],
            password=attrs[PASSWORD_KEY],  # noqa: S105 # NOSONAR
        )
        if not user:
            raise serializers.ValidationError("Невірний email або пароль.")
        # Зверніть увагу: ми викинемо спеціальну помилку для неактивованого акаунту
        if not user.is_active and not user.email_verified:
            raise serializers.ValidationError("email_not_verified")
        elif not user.is_active:
            raise serializers.ValidationError("Обліковий запис деактивовано.")
        attrs["user"] = user
        return attrs


class RoleRequestSerializer(serializers.ModelSerializer):
    """Серіалайзер для запитів на верифікацію ролей."""

    user = UserRoleRequestSerializer(read_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        queryset=Club.objects.all(),
        source="club",
        required=False,
        allow_null=True,
    )
    club_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    club = ClubSerializer(read_only=True)
    reviewed_by = UserPublicSerializer(read_only=True)

    class Meta:
        model = RoleRequest
        fields = [
            "id",
            "user",
            "requested_role",
            "club_id",
            "club_name",
            "club",
            "referee_category",
            "status",
            "details",
            "document",
            "photo_with_id",
            "created_at",
            "reviewed_at",
            "reviewed_by",
            "review_notes",
        ]
        read_only_fields = [
            "id",
            "status",
            "created_at",
            "reviewed_at",
            "reviewed_by",
            "review_notes",
        ]

    def validate(self, attrs):
        # Отримуємо requested_role з вводу або з інстансу при оновленні
        requested_role = attrs.get("requested_role") or (
            self.instance.requested_role if self.instance else None
        )

        if requested_role == User.Role.COACH:
            club = attrs.get("club") or (self.instance.club if self.instance else None)
            club_name = attrs.get("club_name")
            if not club and not club_name:
                raise serializers.ValidationError(
                    {"club_name": "Для ролі тренера необхідно вказати назву клубу."}
                )
        elif requested_role == User.Role.JUDGE:
            referee_category = attrs.get("referee_category") or (
                self.instance.referee_category if self.instance else None
            )
            if not referee_category:
                raise serializers.ValidationError(
                    {"referee_category": "Для ролі судді необхідно вказати категорію."}
                )

        return attrs

    def create(self, validated_data):
        club_name = validated_data.pop("club_name", None)
        if club_name:
            from apps.accounts.models import Club

            # Знаходимо або створюємо клуб за назвою
            club, _ = Club.objects.get_or_create(name=club_name.strip())
            validated_data["club"] = club

        return super().create(validated_data)


class ChangePasswordSerializer(serializers.Serializer):
    """Серіалайзер для зміни пароля."""

    old_password = serializers.CharField(write_only=True, required=True)
    new_password = serializers.CharField(write_only=True, required=True, min_length=8)
    new_password_confirm = serializers.CharField(write_only=True, required=True)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": _("Нові паролі не співпадають.")}
            )
        return attrs
