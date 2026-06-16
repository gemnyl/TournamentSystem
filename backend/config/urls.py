"""
Головний URL-конфігуратор проекту.

Структура:
    /admin/          — Django адмін-панель
    /api/auth/       — автентифікація (логін / логаут / me)
    /api/clubs/      — CRUD клубів
    /api/athletes/   — CRUD спортсменів
    /api/tournaments/— турніри + категорії + реєстрації
    /api/matches/    — поєдинки
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.common.health import liveness, readiness

urlpatterns = [
    path("admin/", admin.site.urls),
    # Health probes (liveness + readiness)
    path("healthz/", liveness, name="healthz"),
    path("readyz/", readiness, name="readyz"),
    # REST API
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.athletes.urls")),
    path("api/", include("apps.tournaments.urls")),
    path("api/", include("apps.matches.urls")),
    path("api/", include("apps.rulesets.urls")),
    path("api/", include("apps.tatamis.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
