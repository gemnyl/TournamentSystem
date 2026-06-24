from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.decorators import display

from apps.tatamis.models import Tatami


@admin.register(Tatami)
class TatamiAdmin(UnfoldModelAdmin):
    list_select_related = ["tournament", "current_match", "assigned_judge"]
    autocomplete_fields = ["assigned_judge", "current_match", "tournament"]

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            return queryset.filter(assigned_judge=request.user)
        return queryset.none()

    list_display = (
        "number",
        "name",
        "tournament",
        "current_match",
        "assigned_judge",
        "scoreboard_ip",
        "status_connection",
        "is_active",
    )
    list_display_links = ("number", "name")
    list_filter = ("tournament", "is_active", "scoreboard_connected")
    search_fields = ["number", "name", "tournament__title"]

    @display(
        description="Підключення табло",
        label={
            True: "success",
            False: "danger",
        },
    )
    def status_connection(self, obj):
        return obj.scoreboard_connected

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        from apps.common.broadcast import broadcast_tatami_state

        try:
            broadcast_tatami_state(obj)
        except Exception as e:
            print(f"Error broadcasting tatami state: {e}")
