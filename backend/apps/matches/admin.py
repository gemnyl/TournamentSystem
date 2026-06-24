from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.admin import TabularInline as UnfoldTabularInline
from unfold.decorators import display

from apps.matches.models import Match, MatchEvent


class MatchEventInline(UnfoldTabularInline):
    model = MatchEvent
    extra = 0
    ordering = ["sequence"]

    # Strict read-only configuration for audit log integrity
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Match)
class MatchAdmin(UnfoldModelAdmin):
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(category__tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            return queryset.filter(tatami__assigned_judge=request.user)
        return queryset.none()

    # Critical query optimizations to avoid N+1 queries in the list display
    list_select_related = [
        "category__tournament",
        "category",
        "athlete_first",
        "athlete_second",
        "tatami",
        "reg_first",
        "reg_second",
        "winner",
    ]

    # Recursive and related fields MUST be autocomplete fields to avoid graph loading lag
    autocomplete_fields = [
        "next_match",
        "loser_next_match",
        "category",
        "athlete_first",
        "athlete_second",
        "reg_first",
        "reg_second",
        "winner",
        "tatami",
        "parent_team_match",
    ]

    list_display = [
        "id",
        "category",
        "round_index",
        "match_order",
        "reg_first",
        "reg_second",
        "score_first",
        "score_second",
        "winner",
        "win_method",
        "status",
    ]
    list_display_links = ["id", "category"]
    list_filter = ["status", "win_method", "category__tournament"]

    # Search fields essential for autocomplete and lookup functionality
    search_fields = [
        "id",
        "category__name",
        "athlete_first__last_name",
        "athlete_second__last_name",
        "athlete_first__first_name",
        "athlete_second__first_name",
    ]
    ordering = ["category", "round_index", "match_order"]
    readonly_fields = ["started_at", "completed_at"]
    inlines = [MatchEventInline]

    fieldsets = (
        (
            "Позиція у сітці",
            {
                "fields": (
                    "category",
                    "round_index",
                    "match_order",
                    "tatami",
                    "next_match",
                    "loser_next_match",
                    "parent_team_match",
                    "bout_index",
                )
            },
        ),
        ("Учасники", {"fields": ("reg_first", "reg_second", "athlete_first", "athlete_second")}),
        (
            "Рахунок",
            {
                "fields": (
                    "score_first",
                    "score_second",
                    "warnings_first",
                    "warnings_second",
                    "senshu",
                )
            },
        ),
        (
            "Результат",
            {
                "fields": (
                    "winner",
                    "win_method",
                    "match_duration",
                    "status",
                    "is_bracket_reset",
                )
            },
        ),
        (
            "Таймер та відображення",
            {
                "fields": (
                    "timer_status",
                    "timer_started_at",
                    "timer_elapsed_ms",
                    "timer_duration_ms",
                    "show_timer",
                )
            },
        ),
        (
            "Часові мітки",
            {
                "fields": ("started_at", "completed_at"),
            },
        ),
    )

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        from apps.common.broadcast import broadcast_match_update

        try:
            broadcast_match_update(obj)
        except Exception as e:
            print(f"Error broadcasting match update: {e}")


class IsUndoFilter(admin.SimpleListFilter):
    title = "Скасовано (Undo)"
    parameter_name = "is_undo"

    def lookups(self, request, model_admin):
        return (
            ("true", "Так"),
            ("false", "Ні"),
        )

    def queryset(self, request, queryset):
        if self.value() == "true":
            return queryset.filter(payload__is_undo=True)
        if self.value() == "false":
            return queryset.exclude(payload__is_undo=True)
        return queryset


@admin.register(MatchEvent)
class MatchEventAdmin(UnfoldModelAdmin):
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(match__category__tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            return queryset.filter(match__tatami__assigned_judge=request.user)
        return queryset.none()

    list_select_related = ["match__category__tournament", "match__category", "match__tatami"]
    list_display = ["id", "match", "get_tournament", "get_category", "event_type", "timestamp"]
    list_filter = [
        "match__category__tournament",
        "match__category",
        "match__tatami",
        "event_type",
        IsUndoFilter,
    ]
    search_fields = ["match__athlete_first__last_name", "match__athlete_second__last_name"]

    @display(description="Турнір")
    def get_tournament(self, obj):
        return obj.match.category.tournament.title

    @display(description="Категорія")
    def get_category(self, obj):
        return obj.match.category.name

    @display(description="Час")
    def timestamp(self, obj):
        return obj.created_at

    # Read-only configuration for standalone access
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
