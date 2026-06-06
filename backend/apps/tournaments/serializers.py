"""
Серіалайзери турнірного рівня: Tournament → Category → Registration.
"""

from rest_framework import serializers

from apps.athletes.models import Athlete
from apps.athletes.serializers import AthleteSerializer
from apps.tournaments.models import Category, Registration, Tournament


class CategorySerializer(serializers.ModelSerializer):
    """Категорія (вагова / вікова) турніру."""

    bracket_format_display = serializers.CharField(
        source="get_bracket_format_display", read_only=True
    )
    allowed_gender_display = serializers.CharField(
        source="get_allowed_gender_display", read_only=True
    )
    status = serializers.CharField(source="tournament.status", read_only=True)
    confirmed_registrations_count = serializers.SerializerMethodField()
    has_bracket = serializers.SerializerMethodField()
    results_finalized = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            "id",
            "tournament",
            "name",
            "allowed_gender",
            "allowed_gender_display",
            "min_age",
            "max_age",
            "min_weight",
            "max_weight",
            "allowed_skill_level",
            "ruleset_key",
            "match_duration_seconds",
            "bracket_format",
            "bracket_format_display",
            "confirmed_registrations_count",
            "has_bracket",
            "status",
            "schedule_order",
            "two_third_places",
            "results_finalized",
            "judges_count",
        ]

    def get_confirmed_registrations_count(self, obj):
        return obj.registrations.filter(status=Registration.Status.CONFIRMED).count()

    def get_has_bracket(self, obj):
        return obj.matches.exists()

    def get_results_finalized(self, obj):
        return obj.registrations.filter(place__isnull=False).exists()


class TournamentSerializer(serializers.ModelSerializer):
    """Список турнірів (без вкладених категорій)."""

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    organizer_name = serializers.CharField(source="organizer.get_full_name", read_only=True)

    class Meta:
        model = Tournament
        fields = [
            "id",
            "title",
            "sport_type",
            "location",
            "start_date",
            "end_date",
            "registration_start",
            "registration_end",
            "completed_at",
            "status",
            "status_display",
            "organizer",
            "organizer_name",
            "weigh_in_required",
            "created_at",
        ]
        read_only_fields = ["organizer", "created_at", "status", "completed_at"]


class TournamentDetailSerializer(TournamentSerializer):
    """Деталі турніру зі вкладеними категоріями."""

    categories = CategorySerializer(many=True, read_only=True)

    class Meta(TournamentSerializer.Meta):
        fields = TournamentSerializer.Meta.fields + ["categories"]


class RegistrationSerializer(serializers.ModelSerializer):
    """Заявка спортсмена на участь у категорії."""

    athlete = AthleteSerializer(read_only=True)
    athlete_id = serializers.PrimaryKeyRelatedField(
        source="athlete",
        # Прямий імпорт безпечний: athletes.models → не імпортує tournaments.serializers.
        queryset=Athlete.objects.all(),
        write_only=True,
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Registration
        fields = [
            "id",
            "athlete",
            "athlete_id",
            "category",
            "category_name",
            "seed_number",
            "recorded_weight",
            "status",
            "status_display",
            "place",
            "created_at",
        ]
        read_only_fields = ["seed_number", "recorded_weight", "status", "place", "created_at"]

    def validate(self, attrs):
        category = attrs.get("category")
        if category:
            tournament = category.tournament
            if tournament.status != tournament.Status.REGISTRATION:
                raise serializers.ValidationError(
                    "Реєстрація можлива лише тоді, коли турнір знаходиться у статусі 'Реєстрація'."
                )

            from django.utils import timezone

            now = timezone.now()
            if tournament.registration_start and now < tournament.registration_start:
                raise serializers.ValidationError("Реєстрація на цей турнір ще не розпочалася.")
            if tournament.registration_end and now > tournament.registration_end:
                raise serializers.ValidationError("Реєстрація на цей турнір вже завершилася.")
        return attrs

    def create(self, validated_data):
        category = validated_data.get("category")
        if category and not category.tournament.weigh_in_required:
            validated_data["status"] = "confirmed"
        return super().create(validated_data)


class CategoryResultSerializer(serializers.Serializer):
    """Результат розрахунку заліку для учасника в категорії."""

    place = serializers.IntegerField(allow_null=True)
    registration = RegistrationSerializer()
    wins = serializers.IntegerField()
    draws = serializers.IntegerField()
    losses = serializers.IntegerField()
    points = serializers.IntegerField()
    scores_scored = serializers.IntegerField()
    scores_conceded = serializers.IntegerField()
