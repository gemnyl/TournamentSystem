"""
Налаштування Django-проекту «Турнірна платформа».

Усі чутливі параметри зчитуються з .env через os.environ.
Для локального розвитку скопіюйте .env.example → .env і заповніть.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Базові шляхи
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Безпека
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-замініть-цей-ключ-у-продакшені",
)

DEBUG = os.environ.get("DJANGO_DEBUG", "True") == "True"

# Guard: у production режимі стандартний insecure-ключ неприйнятний.
if not DEBUG and SECRET_KEY.startswith("django-insecure-"):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY не встановлений або використовується небезпечне "
        "значення за замовчуванням. Встановіть змінну оточення DJANGO_SECRET_KEY."
    )

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost 127.0.0.1").split()

# ---------------------------------------------------------------------------
# Додатки
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    "daphne",
    # Django вбудовані
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Сторонні
    "rest_framework",
    "corsheaders",
    "channels",
    # Власні додатки
    "apps.accounts",
    "apps.athletes",
    "apps.tournaments",
    "apps.matches",
    "apps.brackets",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # має бути першим
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ASGI — точка входу для HTTP + WebSocket (Channels)
ASGI_APPLICATION = "config.asgi.application"
WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# База даних (PostgreSQL)
# ---------------------------------------------------------------------------

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "tournament_db"),
        "USER": os.environ.get("DB_USER", "tournament_user"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "tournament_pass"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# ---------------------------------------------------------------------------
# Django Channels — Redis channel layer
# ---------------------------------------------------------------------------

# У тестовому середовищі (TEST=True або відсутній Redis) використовуємо InMemory.
# Це дозволяє запускати pytest без запущеного Redis.
_use_redis_channel_layer = os.environ.get("USE_REDIS_CHANNEL_LAYER", "True") == "True"

if _use_redis_channel_layer:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [
                    (
                        os.environ.get("REDIS_HOST", "localhost"),
                        int(os.environ.get("REDIS_PORT", 6379)),
                    )
                ],
            },
        },
    }
else:
    # Fallback для тестів без Redis
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }

# ---------------------------------------------------------------------------
# Кастомна модель користувача
# ---------------------------------------------------------------------------

AUTH_USER_MODEL = "accounts.User"

# ---------------------------------------------------------------------------
# Валідація паролів
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# DRF (Django REST Framework)
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    # Сесійна автентифікація + Basic для тестів через браузер
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
    # За замовчуванням API доступний лише автентифікованим
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

# ---------------------------------------------------------------------------
# CORS (фронтенд на порту 5173 — Vite dev server)
# ---------------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173 http://127.0.0.1:5173",
).split()

CORS_ALLOW_CREDENTIALS = True  # необхідно для сесійних cookie

CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS[:]

# ---------------------------------------------------------------------------
# Сесії
# ---------------------------------------------------------------------------

SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 86400 * 7  # 7 днів
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

# ---------------------------------------------------------------------------
# Локалізація
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "uk"
TIME_ZONE = "Europe/Kyiv"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Статичні файли
# ---------------------------------------------------------------------------

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
