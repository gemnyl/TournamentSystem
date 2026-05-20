from django.contrib import admin

from apps.tatamis.models import Tatami


@admin.register(Tatami)
class TatamiAdmin(admin.ModelAdmin):
    list_display = ("tournament", "number", "name", "current_match", "is_active")
    list_filter = ("tournament", "is_active")
