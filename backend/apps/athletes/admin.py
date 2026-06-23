from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.admin import TabularInline as UnfoldTabularInline
from unfold.decorators import display

from apps.athletes.models import Athlete, AthleteWeightLog, Team


class AthleteWeightLogInline(UnfoldTabularInline):
    model = AthleteWeightLog
    extra = 0

    # Strict read-only safety for weigh-in history logs
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Athlete)
class AthleteAdmin(UnfoldModelAdmin):
    list_select_related = ["coach", "club"]
    autocomplete_fields = ["coach", "club"]

    list_display = ("pib", "club", "coach", "age")
    list_filter = ["gender", "club"]
    search_fields = [
        "last_name",
        "first_name",
        "coach__last_name",
        "coach__first_name",
        "club__name",
    ]
    ordering = ["last_name", "first_name"]
    inlines = [AthleteWeightLogInline]

    @display(description="ПІБ", ordering="last_name")
    def pib(self, obj):
        return obj.get_full_name()

    @display(description="Вік")
    def age(self, obj):
        return obj.calculate_current_age()


@admin.register(Team)
class TeamAdmin(UnfoldModelAdmin):
    list_select_related = ["coach", "club"]
    autocomplete_fields = ["coach", "club"]
    filter_horizontal = ("athletes",)

    list_display = ("name", "club", "coach")
    list_filter = ("club", "coach")
    search_fields = ["name", "club__name"]


@admin.register(AthleteWeightLog)
class AthleteWeightLogAdmin(UnfoldModelAdmin):
    list_display = ("athlete", "weight", "logged_at", "notes")
    list_filter = ("logged_at",)
    search_fields = ("athlete__first_name", "athlete__last_name", "notes")

    # Read-only standalone logs access
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
