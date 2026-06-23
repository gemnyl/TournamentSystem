from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Club, EmailConfirmationCode, RoleRequest, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "email",
        "first_name",
        "last_name",
        "role",
        "club",
        "is_club_leader",
        "credit_limit",
        "is_staff",
        "is_active",
    )
    list_filter = ("role", "is_club_leader", "is_staff", "is_active", "is_superuser")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)

    # We need fieldsets since it's a custom AbstractBaseUser
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (
            "Особисті дані",
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
        ("Спортивна інформація", {"fields": ("role", "club", "skill_level", "referee_category")}),
        (
            "Доступи та верифікація",
            {
                "fields": (
                    "is_club_leader",
                    "credit_limit",
                    "email_verified",
                    "is_active",
                    "is_staff",
                    "is_superuser",
                )
            },
        ),
        ("Дати", {"fields": ("last_login", "date_joined")}),
    )
    readonly_fields = ("date_joined",)


@admin.register(Club)
class ClubAdmin(admin.ModelAdmin):
    list_display = ("name", "region")
    list_filter = ("region",)
    search_fields = ("name",)


@admin.register(RoleRequest)
class RoleRequestAdmin(admin.ModelAdmin):
    list_display = ("user", "requested_role", "status", "created_at", "reviewed_by", "reviewed_at")
    list_filter = ("status", "requested_role", "created_at")
    search_fields = ("user__email", "user__first_name", "user__last_name", "details")
    readonly_fields = ("created_at", "reviewed_at", "reviewed_by")

    def save_model(self, request, obj, form, change):
        if change:
            # If changing status and reviewed_by is not set, set it to the saving admin
            if obj.status != "pending" and not obj.reviewed_by:
                from django.utils import timezone

                obj.reviewed_by = request.user
                obj.reviewed_at = timezone.now()
        super().save_model(request, obj, form, change)


@admin.register(EmailConfirmationCode)
class EmailConfirmationCodeAdmin(admin.ModelAdmin):
    list_display = ("user", "code", "created_at", "expires_at")
    search_fields = ("user__email", "code")
