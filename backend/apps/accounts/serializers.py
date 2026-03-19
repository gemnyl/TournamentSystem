"""
Серіалайзери підсистеми автентифікації та організаційної структури.
"""
from django.contrib.auth import authenticate
from rest_framework import serializers

from apps.accounts.models import Club, User


class ClubSerializer(serializers.ModelSerializer):
    """Серіалайзер спортивного клубу."""

    class Meta:
        model = Club
        fields = ['id', 'name', 'region']


class UserSerializer(serializers.ModelSerializer):
    """Читання профілю користувача (без пароля)."""

    club = ClubSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'first_name', 'last_name',
            'full_name', 'role', 'club', 'date_joined',
        ]
        read_only_fields = ['date_joined']

    def get_full_name(self, obj):
        return obj.get_full_name()


class UserRegistrationSerializer(serializers.ModelSerializer):
    """Реєстрація нового облікового запису."""

    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        queryset=Club.objects.all(),
        source='club',
        required=False,
        allow_null=True,
    )

    class Meta:
        model = User
        fields = [
            'email', 'first_name', 'last_name',
            'role', 'club_id', 'password', 'password_confirm',
        ]

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('password_confirm'):
            raise serializers.ValidationError({'password_confirm': 'Паролі не співпадають.'})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    """Серіалайзер для логіну (email + пароль)."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get('request'),
            username=attrs['email'],
            password=attrs['password'],
        )
        if not user:
            raise serializers.ValidationError('Невірний email або пароль.')
        if not user.is_active:
            raise serializers.ValidationError('Обліковий запис деактивовано.')
        attrs['user'] = user
        return attrs