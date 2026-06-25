from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.admin import TabularInline as UnfoldTabularInline
from unfold.decorators import display

from apps.common.admin import BaseTournamentAdminMixin
from apps.matches.models import Match, MatchEvent


def _get_event_description(obj):
    t = obj.event_type
    p = obj.payload or {}

    def get_corner_name(c):
        if not c:
            return ""
        if obj.match.category.ruleset_key == "taekwondo_wt":
            return "Chung (Синій)" if c in ("aka", "chung") else "Hong (Червоний)"
        elif obj.match.category.ruleset_key == "judo_ijf":
            return "Shiro (Білий)" if c in ("aka", "shiro") else "Ao (Синій)"
        else:
            return "AKA (Червоний)" if c in ("aka", "shiro") else "AO (Синій)"

    is_undo = p.get("is_undo") is True
    corner = p.get("corner")
    corner_name = get_corner_name(corner)

    if t == MatchEvent.EventType.SCORE:
        action = p.get("action_key", "").upper()
        return f"{'Скасування' if is_undo else 'Нарахування'} балів: {action} для {corner_name}"

    elif t == MatchEvent.EventType.WARNING:
        action = p.get("action_key", "").upper()
        prefix = "Скасування попередження" if is_undo else "Попередження"
        return f"{prefix}: {action} для {corner_name}"

    elif t == MatchEvent.EventType.SENSHU:
        val = p.get("value")
        return f"Сенсю (перший бал): {'Призначено' if val else 'Скасовано'} для {corner_name}"

    elif t == MatchEvent.EventType.FLAGS_DECISION:
        return f"Рішення прапорами: AKA {p.get('flags_aka', 0)} vs AO {p.get('flags_ao', 0)}"

    elif t == MatchEvent.EventType.START:
        return "Початок поєдинку"

    elif t == MatchEvent.EventType.FINISH:
        win_method = p.get("win_method", "")
        winner_name = get_corner_name(p.get("corner"))
        return f"Завершення поєдинку (метод: {win_method}, переможець: {winner_name})"

    elif t == MatchEvent.EventType.RESET:
        return "Скидання стану поєдинку"

    elif t == MatchEvent.EventType.TIMER_START:
        return "Старт таймера"

    elif t == MatchEvent.EventType.TIMER_PAUSE:
        return "Пауза таймера"

    elif t == MatchEvent.EventType.TIMER_RESUME:
        return "Продовження таймера"

    elif t == MatchEvent.EventType.TIMER_RESET:
        return "Скидання таймера"

    elif t == MatchEvent.EventType.TIMER_SET_DUR:
        if "duration_ms" in p:
            return f"Встановлено час таймера: {p['duration_ms'] // 1000} сек"
        elif "delta_ms" in p:
            return f"Зміна часу таймера на: {p['delta_ms'] // 1000} сек"
        return "Зміна тривалості таймера"

    elif t == MatchEvent.EventType.TIMER_TOGGLE:
        return "Відображення таймера змінено"

    elif t == MatchEvent.EventType.JUDGES_COUNT_CHANGE:
        return f"Зміна кількості суддів: {p.get('judges_count', 0)}"

    elif t == MatchEvent.EventType.RULESET_EVENT:
        re_type = p.get("ruleset_event_type")
        re_payload = p.get("payload") or {}
        re_corner = get_corner_name(re_payload.get("corner"))

        if re_type == "ADD_POINTS":
            return f"Нарахування балів: +{re_payload.get('points')} для {re_corner}"
        elif re_type == "SUB_POINTS":
            return f"Скасування балів: -{re_payload.get('points')} для {re_corner}"
        elif re_type == "ADD_GAM_JEOM":
            is_passive = re_payload.get("is_passive")
            rem_seconds = re_payload.get("remaining_seconds", 999)
            is_passive_last_10 = is_passive and rem_seconds <= 10
            passive_suffix = " (пасивна дія в останні 10 сек)" if is_passive_last_10 else ""
            return f"Gam-jeom для {re_corner}{passive_suffix}"
        elif re_type == "SUB_GAM_JEOM":
            return f"Скасування Gam-jeom для {re_corner}"
        elif re_type == "NEXT_ROUND":
            rw = re_payload.get("round_winner")
            rw_corner = get_corner_name(rw) if rw else None
            if rw_corner:
                return f"Перехід до наступного раунду (переможець: {rw_corner})"
            return "Перехід до наступного раунду"
        elif re_type == "RESET_ROUND":
            return "Скидання раунду"
        elif re_type == "UNDO_ROUND":
            return "Назад (раунд)"
        elif re_type == "ADD_WAZA_ARI":
            return f"Ваза-арі для {re_corner}"
        elif re_type == "SUB_WAZA_ARI":
            return f"Скасування Ваза-арі для {re_corner}"
        elif re_type == "ADD_IPPON":
            return f"Іппон для {re_corner}"
        elif re_type == "SUB_IPPON":
            return f"Скасування Іппон для {re_corner}"
        elif re_type == "ADD_SHIDO":
            return f"Шідо для {re_corner}"
        elif re_type == "SUB_SHIDO":
            return f"Скасування Шідо для {re_corner}"
        elif re_type == "START_OSAEKOMI":
            return f"Початок утримання (Осаєкомі) для {re_corner}"
        elif re_type == "STOP_OSAEKOMI":
            return "Зупинка утримання (Осаєкомі)"

        return f"Подія правил {re_type}: {re_payload}"

    return f"{obj.get_event_type_display()}: {p}"


class MatchEventInline(UnfoldTabularInline):
    model = MatchEvent
    extra = 0
    ordering = ["sequence"]
    fields = ["sequence", "event_description", "judge", "created_at_formatted"]
    readonly_fields = ["sequence", "event_description", "judge", "created_at_formatted"]

    @display(description="Опис події")
    def event_description(self, obj):
        return _get_event_description(obj)

    @display(description="Час")
    def created_at_formatted(self, obj):
        if obj.created_at:
            from django.utils.timezone import localtime

            return localtime(obj.created_at).strftime("%d.%m.%Y %H:%M:%S")
        return "-"

    # Strict read-only configuration for audit log integrity
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Match)
class MatchAdmin(BaseTournamentAdminMixin, UnfoldModelAdmin):
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(category__tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            from django.db.models import Q

            return queryset.filter(
                Q(tatami__assigned_judge=request.user)
                | Q(category__tournament__chief_judge=request.user)
            ).distinct()
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
class MatchEventAdmin(BaseTournamentAdminMixin, UnfoldModelAdmin):
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(match__category__tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            from django.db.models import Q

            return queryset.filter(
                Q(match__tatami__assigned_judge=request.user)
                | Q(match__category__tournament__chief_judge=request.user)
            ).distinct()
        return queryset.none()

    list_select_related = ["match__category__tournament", "match__category", "match__tatami"]
    list_display = [
        "id",
        "match",
        "get_tournament",
        "get_category",
        "event_description",
        "timestamp",
    ]
    list_filter = [
        "match__category__tournament",
        "match__category",
        "match__tatami",
        "event_type",
        IsUndoFilter,
    ]
    search_fields = ["match__athlete_first__last_name", "match__athlete_second__last_name"]

    @display(description="Опис події")
    def event_description(self, obj):
        return _get_event_description(obj)

    @display(description="Турнір")
    def get_tournament(self, obj):
        return obj.match.category.tournament.title

    @display(description="Категорія")
    def get_category(self, obj):
        return obj.match.category.name

    @display(description="Час")
    def timestamp(self, obj):
        from django.utils.timezone import localtime

        if obj.created_at:
            return localtime(obj.created_at).strftime("%d.%m.%Y %H:%M:%S")
        return "-"

    # Read-only configuration for standalone access
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_superuser or request.user.role == "admin":
            return True
        if obj is None:
            from django.contrib.auth import get_user_model

            User = get_user_model()
            return request.user.role in (User.Role.ORGANIZER, User.Role.JUDGE)

        is_org = obj.match.category.tournament.organizer == request.user
        is_cj = obj.match.category.tournament.chief_judge == request.user
        is_assigned_judge = obj.match.tatami and obj.match.tatami.assigned_judge == request.user
        return is_org or is_cj or is_assigned_judge
