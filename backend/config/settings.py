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

if not DEBUG and SECRET_KEY.startswith("django-insecure-"):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY не встановлений або використовується небезпечне "
        "значення за замовчуванням. Встановіть змінну оточення DJANGO_SECRET_KEY."
    )


def parse_env_list(var_name, default=""):
    value = os.environ.get(var_name, default) or ""
    return [item.strip() for item in value.replace(",", " ").split() if item.strip()]


_docker_hosts = parse_env_list("DJANGO_ALLOWED_HOSTS")
_env_hosts = parse_env_list("ALLOWED_HOSTS")

ALLOWED_HOSTS = list(set(_docker_hosts + _env_hosts))

for fallback in ["localhost", "127.0.0.1", "backend", "0.0.0.0"]:
    if fallback not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(fallback)

# ---------------------------------------------------------------------------
# Додатки
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    "apps.common",  # Has to be first to override templates
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "unfold.contrib.inlines",
    "unfold.contrib.import_export",
    "import_export",
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
    "apps.rulesets",
    "apps.tatamis",
    "apps.billing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
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

_use_redis_channel_layer = os.environ.get("USE_REDIS_CHANNEL_LAYER", "True") == "True"

if _use_redis_channel_layer:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [
                    {
                        "address": (
                            f"redis://{os.environ.get('REDIS_HOST', 'localhost')}:"
                            f"{int(os.environ.get('REDIS_PORT', 6379))}"
                        ),
                        "socket_timeout": 30.0,
                        "socket_connect_timeout": 30.0,
                    }
                ],
            },
        },
    }
else:
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
# DRF
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/minute",
        "user": "500/minute",
        "auth": "5/minute",
    },
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

_cors_raw = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173 http://127.0.0.1:5173",
)
CORS_ALLOWED_ORIGINS = [
    item.strip() for item in _cors_raw.replace(",", " ").split() if item.strip()
]

CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS[:]

for host in ALLOWED_HOSTS:
    is_local = host in ["localhost", "127.0.0.1", "backend", "0.0.0.0"]
    if not is_local and not host.startswith("192.168."):
        clean_host = host.lstrip(".")
        for proto in ["http", "https"]:
            origin = f"{proto}://{clean_host}"
            if origin not in CORS_ALLOWED_ORIGINS:
                CORS_ALLOWED_ORIGINS.append(origin)
            if host.startswith("."):
                wildcard_origin = f"{proto}://*.{clean_host}"
                if wildcard_origin not in CSRF_TRUSTED_ORIGINS:
                    CSRF_TRUSTED_ORIGINS.append(wildcard_origin)

# ---------------------------------------------------------------------------
# Сесії та локалізація
# ---------------------------------------------------------------------------

SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 86400 * 7
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

LANGUAGE_CODE = "uk"
TIME_ZONE = "Europe/Kyiv"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = "noreply@tournamentapp.local"

# ---------------------------------------------------------------------------
# Налаштування платіжного шлюзу Monobank
# ---------------------------------------------------------------------------

MONOBANK_TOKEN = os.environ.get("MONOBANK_TOKEN", "")
MONOBANK_USE_SANDBOX = os.environ.get("MONOBANK_USE_SANDBOX", "True") == "True"
MONOBANK_MOCK_PAYMENTS = os.environ.get("MONOBANK_MOCK_PAYMENTS", "True") == "True"

# ---------------------------------------------------------------------------
# Налаштування теми Unfold
# ---------------------------------------------------------------------------

UNFOLD = {
    "SITE_TITLE": "TournamentSystem Admin",
    "SITE_HEADER": "TournamentSystem Admin",
    "SITE_SYMBOL": "emoji_events",
    "SHOW_HISTORY": True,
    "DARK_MODE": True,
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": False,
        "navigation": [
            {
                "title": "Управління доступом",
                "separator": True,
                "collapsible": True,
                "items": [
                    {
                        "title": "Користувачі",
                        "link": "/admin/accounts/user/",
                        "icon": "group",
                    },
                    {
                        "title": "Заявки на ролі",
                        "link": "/admin/accounts/rolerequest/",
                        "icon": "rule_folder",
                    },
                    {
                        "title": "Клуби",
                        "link": "/admin/accounts/club/",
                        "icon": "domain",
                    },
                    {
                        "title": "Бани",
                        "link": "/admin/accounts/user/?is_active=False",
                        "icon": "block",
                    },
                ],
            },
            {
                "title": "Спортсмени",
                "separator": True,
                "collapsible": True,
                "items": [
                    {
                        "title": "Профілі",
                        "link": "/admin/athletes/athlete/",
                        "icon": "badge",
                    },
                    {
                        "title": "Команди",
                        "link": "/admin/athletes/team/",
                        "icon": "groups",
                    },
                    {
                        "title": "Історія зважувань",
                        "link": "/admin/athletes/athleteweightlog/",
                        "icon": "fitness_center",
                    },
                ],
            },
            {
                "title": "Турніри",
                "separator": True,
                "collapsible": True,
                "items": [
                    {
                        "title": "Турніри",
                        "link": "/admin/tournaments/tournament/",
                        "icon": "emoji_events",
                    },
                    {
                        "title": "Категорії",
                        "link": "/admin/tournaments/category/",
                        "icon": "category",
                    },
                    {
                        "title": "Реєстрації",
                        "link": "/admin/tournaments/registration/",
                        "icon": "assignment",
                    },
                ],
            },
            {
                "title": "Проведення",
                "separator": True,
                "collapsible": True,
                "items": [
                    {
                        "title": "Татамі",
                        "link": "/admin/tatamis/tatami/",
                        "icon": "layers",
                    },
                    {
                        "title": "Матчі",
                        "link": "/admin/matches/match/",
                        "icon": "sports_martial_arts",
                    },
                    {
                        "title": "Події матчів",
                        "link": "/admin/matches/matchevent/",
                        "icon": "history",
                    },
                ],
            },
            {
                "title": "Фінанси та Білінг",
                "separator": True,
                "collapsible": True,
                "items": [
                    {
                        "title": "Рахунки",
                        "link": "/admin/billing/paymentinvoice/",
                        "icon": "receipt_long",
                    },
                    {
                        "title": "Транзакції",
                        "link": "/admin/billing/transaction/",
                        "icon": "payments",
                    },
                    {
                        "title": "Виплати",
                        "link": "/admin/billing/payoutrequest/",
                        "icon": "account_balance",
                    },
                ],
            },
        ],
    },
    "DASHBOARD_CALLBACK": "apps.common.admin.dashboard_callback",
}
