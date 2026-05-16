"""
Моделі підсистеми ідентифікації та організаційної структури.

Реалізує кастомну модель користувача замість стандартної Django-моделі
для підтримки email як основного ідентифікатора та рольової моделі
доступу, описаної у п. 2.1 пояснювальної записки.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models


class Club(models.Model):
    """Спортивний клуб або федерація (довідкова сутність).

    Використовується алгоритмом жеребкування для розведення одноклубників
    по різних гілках турнірної сітки на ранніх етапах змагань.
    """

    name = models.CharField(max_length=200, unique=True, verbose_name="Назва")
    region = models.CharField(max_length=150, blank=True, verbose_name="Регіон")

    class Meta:
        db_table = "club"
        verbose_name = "Клуб"
        verbose_name_plural = "Клуби"
        ordering = ["name"]

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    """Менеджер користувачів з email як USERNAME_FIELD."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email є обов'язковим полем")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Обліковий запис з рольовою моделлю доступу."""

    class Role(models.TextChoices):
        ORGANIZER = "organizer", "Організатор"
        COACH = "coach", "Тренер"
        JUDGE = "judge", "Суддя"
        ADMIN = "admin", "Адміністратор"
        SPECTATOR = "spectator", "Глядач"

    email = models.EmailField(max_length=254, unique=True, verbose_name="Email")
    first_name = models.CharField(max_length=150, verbose_name="Ім'я")
    last_name = models.CharField(max_length=150, verbose_name="Прізвище")
    role = models.CharField(
        max_length=50, choices=Role.choices, default=Role.SPECTATOR, verbose_name="Роль"
    )
    club = models.ForeignKey(
        Club,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
        verbose_name="Клуб",
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        db_table = "auth_user"
        verbose_name = "Користувач"
        verbose_name_plural = "Користувачі"

    def __str__(self):
        return f"{self.get_full_name()} ({self.get_role_display()})"

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def get_short_name(self):
        return self.first_name
