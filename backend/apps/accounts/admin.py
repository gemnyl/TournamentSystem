from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db.models import Count
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.decorators import action, display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from .models import Club, EmailConfirmationCode, PasswordResetCode, RoleRequest, User


@admin.register(User)
class UserAdmin(BaseUserAdmin, UnfoldModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm

    list_display = (
        "pib",
        "email",
        "role",
        "club",
        "is_club_leader",
        "credit_limit",
        "status_banned",
        "status_email_verified",
    )
    list_filter = (
        "role",
        "is_club_leader",
        "is_banned",
        "email_verified",
        "is_staff",
        "is_active",
        "is_superuser",
    )
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)

    # Grouping fieldsets based on the requested structure
    fieldsets = (
        ("Авторизація", {"fields": ("email", "password")}),
        (
            "Персональні дані",
            {
                "fields": (
                    "first_name",
                    "last_name",
                    "patronymic",
                    "photo",
                    "phone",
                    "birth_date",
                    "gender",
                )
            },
        ),
        ("Спортивна інформація", {"fields": ("club", "skill_level", "referee_category")}),
        (
            "Статус акаунту та білінг",
            {
                "fields": (
                    "role",
                    "is_club_leader",
                    "credit_limit",
                    "email_verified",
                    "is_banned",
                    "ban_reason",
                    "is_active",
                    "is_staff",
                    "is_superuser",
                )
            },
        ),
        ("Дати", {"fields": ("last_login", "date_joined")}),
    )
    readonly_fields = ("date_joined",)

    @display(description="ПІБ", ordering="last_name")
    def pib(self, obj):
        return obj.get_full_name()

    @display(
        description="Статус бану",
        label={
            "Забанено": "danger",
            "Активний": "success",
        },
    )
    def status_banned(self, obj):
        return "Забанено" if obj.is_banned else "Активний"

    @display(
        description="Верифікація email",
        label={
            "Підтверджено": "success",
            "Не підтверджено": "warning",
        },
    )
    def status_email_verified(self, obj):
        return "Підтверджено" if obj.email_verified else "Не підтверджено"


@admin.register(Club)
class ClubAdmin(UnfoldModelAdmin):
    search_fields = ("name", "region")
    list_display = ("name", "region", "athletes_count")
    list_filter = ("region",)

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        queryset = queryset.annotate(athletes_count_anno=Count("athletes"))
        return queryset

    @display(description="Кількість спортсменів", ordering="athletes_count_anno")
    def athletes_count(self, obj):
        return obj.athletes_count_anno


@admin.register(RoleRequest)
class RoleRequestAdmin(UnfoldModelAdmin):
    list_display = (
        "user",
        "requested_role",
        "status_badge",
        "created_at",
        "reviewed_by",
        "reviewed_at",
    )
    list_filter = ("status", "requested_role", "created_at")
    search_fields = ("user__email", "user__first_name", "user__last_name", "details")
    readonly_fields = ("created_at", "reviewed_at", "reviewed_by")

    actions_list = ["approve_requests", "reject_requests"]

    @display(
        description="Статус",
        label={
            "pending": "warning",
            "approved": "success",
            "rejected": "danger",
        },
    )
    def status_badge(self, obj):
        return obj.status

    @action(description="Схвалити вибрані запити", icon="check_circle")
    def approve_requests(self, request, queryset):
        count = 0
        from django.utils import timezone

        for obj in queryset:
            if obj.status == RoleRequest.Status.PENDING:
                obj.status = RoleRequest.Status.APPROVED
                obj.reviewed_by = request.user
                obj.reviewed_at = timezone.now()
                obj.save()  # Triggers save() logic to update User role
                count += 1
        self.message_user(request, f"Схвалено запитів: {count}.")

    @action(description="Відхилити вибрані запити", icon="cancel")
    def reject_requests(self, request, queryset):
        count = 0
        from django.utils import timezone

        for obj in queryset:
            if obj.status == RoleRequest.Status.PENDING:
                obj.status = RoleRequest.Status.REJECTED
                obj.reviewed_by = request.user
                obj.reviewed_at = timezone.now()
                obj.save()
                count += 1
        self.message_user(request, f"Відхилено запитів: {count}.")


@admin.register(EmailConfirmationCode)
class EmailConfirmationCodeAdmin(UnfoldModelAdmin):
    list_display = ("user", "code", "created_at", "expires_at")
    search_fields = ("user__email", "code")


@admin.register(PasswordResetCode)
class PasswordResetCodeAdmin(UnfoldModelAdmin):
    list_display = ("user", "code", "created_at", "expires_at")
    search_fields = ("user__email", "code")
