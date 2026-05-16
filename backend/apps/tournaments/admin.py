"""Адмін-панель для турнірної підсистеми."""

from django.contrib import admin

from apps.tournaments.models import Category, Registration, Tournament


class CategoryInline(admin.TabularInline):
    model = Category
    extra = 0
    fields = [
        "name",
        "allowed_gender",
        "min_age",
        "max_age",
        "min_weight",
        "max_weight",
        "bracket_format",
    ]
    show_change_link = True


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ["id", "title", "sport_type", "location", "start_date", "status", "organizer"]
    list_filter = ["status", "sport_type"]
    search_fields = ["title", "location", "organizer__email"]
    ordering = ["-start_date"]
    inlines = [CategoryInline]
    raw_id_fields = ["organizer"]


class RegistrationInline(admin.TabularInline):
    model = Registration
    extra = 0
    fields = ["athlete", "seed_number", "recorded_weight", "status"]
    readonly_fields = ["created_at"]
    show_change_link = True


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "name",
        "tournament",
        "allowed_gender",
        "min_weight",
        "max_weight",
        "bracket_format",
    ]
    list_filter = ["bracket_format", "allowed_gender", "tournament"]
    search_fields = ["name", "tournament__title"]
    inlines = [RegistrationInline]
    raw_id_fields = ["tournament"]


@admin.register(Registration)
class RegistrationAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "athlete",
        "category",
        "seed_number",
        "recorded_weight",
        "status",
        "created_at",
    ]
    list_filter = ["status", "category"]
    search_fields = ["athlete__first_name", "athlete__last_name", "category__name"]
    ordering = ["category", "seed_number"]
    raw_id_fields = ["athlete", "category"]
