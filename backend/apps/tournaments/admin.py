from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import Count
from import_export import fields, resources
from import_export.admin import ImportExportModelAdmin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.admin import TabularInline as UnfoldTabularInline
from unfold.contrib.import_export.forms import ExportForm, ImportForm
from unfold.decorators import action, display

from apps.common.admin import BaseTournamentAdminMixin
from apps.tatamis.models import Tatami
from apps.tournaments.models import Category, Registration, Tournament


# --- Inlines ---
class CategoryInline(UnfoldTabularInline):
    model = Category
    extra = 0
    tab = True
    fields = [
        "name",
        "allowed_gender",
        "min_age",
        "max_age",
        "min_weight",
        "max_weight",
        "bracket_format",
        "registration_fee",
    ]
    show_change_link = True


class TatamiInline(UnfoldTabularInline):
    model = Tatami
    extra = 0
    tab = True
    autocomplete_fields = ["assigned_judge", "current_match"]
    show_change_link = True


# --- Resource for Export/Import ---
class RegistrationResource(resources.ModelResource):
    athlete_name = fields.Field(attribute="athlete", column_name="Спортсмен")
    team_name = fields.Field(attribute="team__name", column_name="Команда")
    category_name = fields.Field(attribute="category__name", column_name="Категорія")
    tournament_title = fields.Field(attribute="category__tournament__title", column_name="Турнір")

    class Meta:
        model = Registration
        fields = (
            "id",
            "athlete_name",
            "team_name",
            "category_name",
            "tournament_title",
            "seed_number",
            "recorded_weight",
            "status",
            "payment_status",
            "payment_method",
            "checked_in",
            "created_at",
        )
        export_order = (
            "id",
            "tournament_title",
            "category_name",
            "athlete_name",
            "team_name",
            "seed_number",
            "recorded_weight",
            "status",
            "payment_status",
            "payment_method",
            "checked_in",
            "created_at",
        )

    def dehydrate_athlete_name(self, registration):
        if registration.athlete:
            return registration.athlete.get_full_name()
        return ""


# --- ModelAdmins ---
@admin.register(Tournament)
class TournamentAdmin(BaseTournamentAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "title", "sport_type", "location", "start_date", "status", "organizer"]
    list_display_links = ["id", "title"]
    list_filter = ["status", "sport_type"]
    search_fields = ["title", "location", "organizer__email"]
    ordering = ["-start_date"]
    autocomplete_fields = ["organizer", "chief_judge", "judges"]
    inlines = [CategoryInline, TatamiInline]

    actions_list = ["open_registration", "start_tournament"]

    # Structuring fields into logical visual groups
    fieldsets = (
        (
            "Основна інфо",
            {
                "fields": (
                    "organizer",
                    "chief_judge",
                    "judges",
                    "title",
                    "sport_type",
                    "status",
                    "use_check_in",
                )
            },
        ),
        (
            "Дати",
            {
                "fields": (
                    "start_date",
                    "end_date",
                    "registration_start",
                    "registration_end",
                    "completed_at",
                )
            },
        ),
        ("Локація", {"fields": ("location",)}),
        (
            "Фінанси (Внески, Комісія платформи)",
            {
                "fields": (
                    "online_payment_enabled",
                    "payment_details",
                    "base_registration_fee",
                    "ruleset_prices",
                    "base_team_registration_fee",
                    "ruleset_team_prices",
                    "commission_payer",
                    "platform_fee_status",
                    "platform_fee_amount",
                )
            },
        ),
    )
    readonly_fields = ("completed_at", "platform_fee_amount")

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            from django.db.models import Q

            return queryset.filter(
                Q(tatamis__assigned_judge=request.user) | Q(chief_judge=request.user)
            ).distinct()
        return queryset.none()

    def save_model(self, request, obj, form, change):
        User = get_user_model()
        if not request.user.is_superuser and request.user.role == User.Role.ORGANIZER:
            obj.organizer = request.user
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None):
        if request.user.is_superuser:
            return True
        User = get_user_model()
        if request.user.role == User.Role.ADMIN:
            return True
        if obj is not None:
            if obj.organizer != request.user:
                return False
            # Block delete if brackets are generated
            from apps.matches.models import Match

            if Match.objects.filter(category__tournament=obj).exists():
                return False
            # Block delete if registrations are paid
            if Registration.objects.filter(
                category__tournament=obj, payment_status="paid"
            ).exists():
                return False
            if request.user.role == User.Role.ORGANIZER:
                return True
        else:
            if request.user.role == User.Role.ORGANIZER:
                return True
        if request.user.role not in (User.Role.ORGANIZER, User.Role.ADMIN):
            return False
        return super().has_delete_permission(request, obj)

    @action(description="Відкрити реєстрацію", icon="lock_open")
    def open_registration(self, request, queryset):
        count = 0
        for obj in queryset:
            try:
                obj.open_registration()
                count += 1
            except ValidationError as e:
                self.message_user(request, f"Помилка для {obj}: {e.message}", level=messages.ERROR)
        if count > 0:
            self.message_user(request, f"Відкрито реєстрацію для {count} турнірів.")

    @action(description="Розпочати турнір", icon="play_arrow")
    def start_tournament(self, request, queryset):
        count = 0
        for obj in queryset:
            try:
                obj.start_tournament()
                count += 1
            except ValidationError as e:
                self.message_user(request, f"Помилка для {obj}: {e.message}", level=messages.ERROR)
        if count > 0:
            self.message_user(request, f"Розпочато {count} турнірів.")


@admin.register(Category)
class CategoryAdmin(BaseTournamentAdminMixin, UnfoldModelAdmin):
    list_select_related = ["tournament"]
    list_display = (
        "id",
        "name",
        "tournament",
        "allowed_gender",
        "age_range",
        "weight_range",
        "bracket_format",
        "participants_count_display",
    )
    list_display_links = ("id", "name")
    list_filter = ["bracket_format", "allowed_gender", "tournament"]
    search_fields = ["name", "tournament__title"]
    autocomplete_fields = ["tournament"]

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        # Annotate queryset with participants count to avoid N+1 queries
        queryset = queryset.annotate(participants_count=Count("registrations"))
        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            from django.db.models import Q

            return queryset.filter(
                Q(tournament__tatamis__assigned_judge=request.user)
                | Q(tournament__chief_judge=request.user)
            ).distinct()
        return queryset.none()

    @display(description="Учасники", ordering="participants_count")
    def participants_count_display(self, obj):
        return obj.participants_count

    @display(description="Вік")
    def age_range(self, obj):
        return f"{obj.min_age} - {obj.max_age}"

    @display(description="Вага")
    def weight_range(self, obj):
        min_w = obj.min_weight if obj.min_weight is not None else "0"
        max_w = obj.max_weight if obj.max_weight is not None else "∞"
        return f"{min_w} - {max_w} кг"


@admin.register(Registration)
class RegistrationAdmin(BaseTournamentAdminMixin, UnfoldModelAdmin, ImportExportModelAdmin):
    resource_classes = [RegistrationResource]
    import_form_class = ImportForm
    export_form_class = ExportForm
    list_select_related = ["category__tournament", "category", "athlete", "team"]

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        User = get_user_model()
        if request.user.is_superuser or request.user.role == User.Role.ADMIN:
            return queryset
        if request.user.role == User.Role.ORGANIZER:
            return queryset.filter(category__tournament__organizer=request.user)
        if request.user.role == User.Role.JUDGE:
            from django.db.models import Q

            return queryset.filter(
                Q(category__tournament__tatamis__assigned_judge=request.user)
                | Q(category__tournament__chief_judge=request.user)
            ).distinct()
        return queryset.none()

    def has_delete_permission(self, request, obj=None):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        User = get_user_model()
        if request.user.role == User.Role.ADMIN:
            return True
        if request.user.role == User.Role.ORGANIZER:
            if obj is None:
                return True
            return obj.category.tournament.organizer == request.user
        return False

    list_display = [
        "id",
        "participant_display",
        "category",
        "tournament_display",
        "seed_number",
        "recorded_weight",
        "status_badge",
        "payment_status_badge",
        "created_at",
    ]
    list_display_links = ["id", "participant_display"]
    list_filter = ["status", "payment_status", "category__tournament", "category"]
    search_fields = [
        "athlete__last_name",
        "athlete__first_name",
        "team__name",
        "category__name",
        "category__tournament__title",
    ]
    ordering = ["category", "seed_number"]
    autocomplete_fields = ["athlete", "team", "category"]

    actions_list = ["mass_confirm_payment", "mass_confirm_weigh_in"]

    @display(description="Учасник")
    def participant_display(self, obj):
        if obj.athlete:
            return obj.athlete.get_full_name()
        if obj.team:
            return f"Команда: {obj.team.name}"
        return "TBD"

    @display(description="Турнір")
    def tournament_display(self, obj):
        return obj.category.tournament.title

    @display(
        description="Статус заявки",
        label={
            "pending": "warning",
            "confirmed": "success",
            "rejected": "danger",
            "withdrawn": "info",
        },
    )
    def status_badge(self, obj):
        return obj.status

    @display(
        description="Статус оплати",
        label={
            "paid": "success",
            "unpaid": "danger",
        },
    )
    def payment_status_badge(self, obj):
        return obj.payment_status

    @action(description="Підтвердити оплату для вибраних заявок", icon="credit_card")
    def mass_confirm_payment(self, request, queryset):
        updated = queryset.update(payment_status="paid")
        self.message_user(request, f"Успішно підтверджено оплату для {updated} заявок.")

    @action(description="Підтвердити зважування для вибраних заявок", icon="scale")
    def mass_confirm_weigh_in(self, request, queryset):
        count = 0
        for obj in queryset:
            if obj.status == Registration.Status.PENDING:
                try:
                    if obj.athlete:
                        # Use the athlete's base_weight as the recorded_weight
                        weight = float(obj.athlete.base_weight)
                        obj.confirm_weigh_in(weight)
                    else:
                        # For teams or fallback, set status directly to CONFIRMED
                        obj.status = Registration.Status.CONFIRMED
                        obj.save(update_fields=["status"])
                    count += 1
                except ValidationError as e:
                    self.message_user(
                        request, f"Помилка для {obj}: {e.message}", level=messages.ERROR
                    )
        if count > 0:
            self.message_user(request, f"Підтверджено зважування та участь для {count} заявок.")
