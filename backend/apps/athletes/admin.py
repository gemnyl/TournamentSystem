"""Адмін-панель для спортсменів."""

from django.contrib import admin

from apps.athletes.models import Athlete


@admin.register(Athlete)
class AthleteAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "last_name",
        "first_name",
        "gender",
        "birth_date",
        "base_weight",
        "skill_level",
        "club",
        "coach",
    ]
    list_filter = ["gender", "club", "coach"]
    search_fields = ["first_name", "last_name", "club__name", "coach__email"]
    ordering = ["last_name", "first_name"]
    raw_id_fields = ["club", "coach"]
