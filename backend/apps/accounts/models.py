"""
Моделі підсистеми ідентифікації та організаційної структури.

Реалізує кастомну модель користувача замість стандартної Django-моделі
для підтримки email як основного ідентифікатора та рольової моделі
доступу, описаної у п. 2.1 пояснювальної записки.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

UKRAINIAN_REGIONS = [
    ("vinnytsia", "Вінницька область"),
    ("volyn", "Волинська область"),
    ("dnipro", "Дніпропетровська область"),
    ("donetsk", "Донецька область"),
    ("zhytomyr", "Житомирська область"),
    ("zakarpattia", "Закарпатська область"),
    ("zaporizhzhia", "Запорізька область"),
    ("ivano-frankivsk", "Івано-Франківська область"),
    ("kyiv_oblast", "Київська область"),
    ("kyiv_city", "м. Київ"),
    ("kirovohrad", "Кіровоградська область"),
    ("luhansk", "Луганська область"),
    ("lviv", "Львівська область"),
    ("mykolaiv", "Миколаївська область"),
    ("odesa", "Одеська область"),
    ("poltava", "Полтавська область"),
    ("rivne", "Рівненська область"),
    ("sumy", "Сумська область"),
    ("ternopil", "Тернопільська область"),
    ("kharkiv", "Харківська область"),
    ("kherson", "Херсонська область"),
    ("khmelnytskyi", "Хмельницька область"),
    ("cherkasy", "Черкаська область"),
    ("chernivtsi", "Чернівецька область"),
    ("chernihiv", "Чернігівська область"),
    ("crimea", "АР Крим"),
    ("sevastopol", "м. Севастополь"),
]


class Club(models.Model):
    """Спортивний клуб або федерація (довідкова сутність).

    Використовується алгоритмом жеребкування для розведення одноклубників
    по різних гілках турнірної сітки на ранніх етапах змагань.
    """

    name = models.CharField(max_length=200, unique=True, verbose_name="Назва")
    region = models.CharField(
        max_length=150,
        choices=UKRAINIAN_REGIONS,
        blank=True,
        verbose_name="Регіон",
    )

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
        extra_fields.setdefault("email_verified", True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Обліковий запис з рольовою моделлю доступу."""

    class Role(models.TextChoices):
        ORGANIZER = "organizer", "Організатор"
        COACH = "coach", "Тренер"
        JUDGE = "judge", "Суддя"
        ADMIN = "admin", "Адміністратор"
        SPECTATOR = "spectator", "Глядач"
        STAFF = "staff", "Персонал"

    email = models.EmailField(max_length=254, unique=True, verbose_name="Email")
    first_name = models.CharField(max_length=150, verbose_name="Ім'я")
    last_name = models.CharField(max_length=150, verbose_name="Прізвище")
    patronymic = models.CharField(max_length=150, blank=True, verbose_name="По-батькові")
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
    photo = models.ImageField(upload_to="photos/", null=True, blank=True, verbose_name="Фото")
    phone = models.CharField(max_length=20, blank=True, verbose_name="Телефон")
    birth_date = models.DateField(null=True, blank=True, verbose_name="Дата народження")
    gender = models.CharField(
        max_length=10,
        choices=[("male", "Чоловік"), ("female", "Жінка")],
        blank=True,
        verbose_name="Стать",
    )
    skill_level = models.CharField(
        max_length=100, blank=True, verbose_name="Рівень майстерності (пояс/дан)"
    )
    referee_category = models.CharField(
        max_length=100, blank=True, verbose_name="Суддівська категорія"
    )
    email_verified = models.BooleanField(default=False, verbose_name="Email підтверджено")
    name_locked = models.BooleanField(default=True, verbose_name="ПІБ заблоковано")
    is_club_leader = models.BooleanField(
        default=False,
        verbose_name="Керівник клубу",
        help_text="Дає право сплачувати за всіх членів клубу",
    )
    credit_limit = models.PositiveIntegerField(
        default=1000,
        verbose_name="Кредитний ліміт комісії (UAH)",
        help_text="Максимальна сума боргу перед платформою",
    )
    is_banned = models.BooleanField(default=False, verbose_name="Заблоковано")
    ban_reason = models.TextField(blank=True, verbose_name="Причина блокування")
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
        return f"{self.last_name} {self.first_name} {self.patronymic}".strip()

    def get_short_name(self):
        return self.first_name


class EmailConfirmationCode(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_confirmation_code",
        verbose_name="Користувач",
    )
    code = models.CharField(max_length=6, verbose_name="Код підтвердження")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Створено")
    expires_at = models.DateTimeField(verbose_name="Дійсний до")

    class Meta:
        db_table = "email_confirmation_code"
        verbose_name = "Код підтвердження email"
        verbose_name_plural = "Коди підтвердження email"

    def __str__(self):
        return f"{self.user.email} - {self.code}"


class PasswordResetCode(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_code",
        verbose_name="Користувач",
    )
    code = models.CharField(max_length=6, verbose_name="Код скидання")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Створено")
    expires_at = models.DateTimeField(verbose_name="Дійсний до")

    class Meta:
        db_table = "password_reset_code"
        verbose_name = "Код скидання пароля"
        verbose_name_plural = "Коди скидання пароля"

    def __str__(self):
        return f"{self.user.email} - {self.code}"


class RoleRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Очікує"
        APPROVED = "approved", "Схвалено"
        REJECTED = "rejected", "Відхилено"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="role_requests",
        verbose_name="Користувач",
    )
    requested_role = models.CharField(
        max_length=50,
        choices=User.Role.choices,
        verbose_name="Бажана роль",
    )
    club = models.ForeignKey(
        Club,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="role_requests",
        verbose_name="Клуб",
    )
    referee_category = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Суддівська категорія",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        verbose_name="Статус",
    )
    details = models.TextField(
        blank=True,
        verbose_name="Додаткові відомості (пояс, ліцензії тощо)",
    )
    document = models.FileField(
        upload_to="role_requests/",
        null=True,
        blank=True,
        verbose_name="Документ підтвердження",
    )
    photo_with_id = models.FileField(
        upload_to="role_requests/",
        null=True,
        blank=True,
        verbose_name="Фото з посвідченням",
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Дата подачі",
    )
    reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата перевірки",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_requests",
        verbose_name="Перевірив",
    )
    review_notes = models.TextField(
        blank=True,
        verbose_name="Коментар адміністратора",
    )

    class Meta:
        db_table = "role_request"
        verbose_name = "Запит на верифікацію ролі"
        verbose_name_plural = "Запити на верифікацію ролей"
        ordering = ["-created_at"]

    def __str__(self):
        role = self.get_requested_role_display()
        status = self.get_status_display()
        return f"{self.user.email} -> {role} ({status})"

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        old_status = None
        if not is_new:
            try:
                old_status = RoleRequest.objects.get(pk=self.pk).status
            except RoleRequest.DoesNotExist:
                pass

        super().save(*args, **kwargs)

        # If status changed to approved (or if it's new and approved)
        if self.status == self.Status.APPROVED and old_status != self.Status.APPROVED:
            user = self.user
            user.role = self.requested_role
            if self.requested_role == User.Role.COACH and self.club:
                user.club = self.club
            user.save()
