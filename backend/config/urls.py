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
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),

    # REST API
    path('api/auth/',        include('apps.accounts.urls')),
    path('api/',             include('apps.athletes.urls')),
    path('api/',             include('apps.tournaments.urls')),
    path('api/',             include('apps.matches.urls')),
]