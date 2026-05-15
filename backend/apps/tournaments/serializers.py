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
        source='get_bracket_format_display', read_only=True
    )
    allowed_gender_display = serializers.CharField(
        source='get_allowed_gender_display', read_only=True
    )
    status = serializers.CharField(
        source='tournament.status', read_only=True
    )
    confirmed_registrations_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            'id', 'tournament', 'name',
            'allowed_gender', 'allowed_gender_display',
            'min_age', 'max_age',
            'min_weight', 'max_weight',
            'allowed_skill_level',
            'bracket_format', 'bracket_format_display',
            'confirmed_registrations_count', 'status',
        ]

    def get_confirmed_registrations_count(self, obj):
        return obj.registrations.filter(status=Registration.Status.CONFIRMED).count()


class TournamentSerializer(serializers.ModelSerializer):
    """Список турнірів (без вкладених категорій)."""

    status_display = serializers.CharField(source='get_status_display', read_only=True)
    organizer_name = serializers.CharField(
        source='organizer.get_full_name', read_only=True
    )

    class Meta:
        model = Tournament
        fields = [
            'id', 'title', 'sport_type', 'location',
            'start_date', 'end_date',
            'status', 'status_display',
            'organizer', 'organizer_name',
            'created_at',
        ]
        read_only_fields = ['organizer', 'created_at', 'status']


class TournamentDetailSerializer(TournamentSerializer):
    """Деталі турніру зі вкладеними категоріями."""

    categories = CategorySerializer(many=True, read_only=True)

    class Meta(TournamentSerializer.Meta):
        fields = TournamentSerializer.Meta.fields + ['categories']


class RegistrationSerializer(serializers.ModelSerializer):
    """Заявка спортсмена на участь у категорії."""

    athlete = AthleteSerializer(read_only=True)
    athlete_id = serializers.PrimaryKeyRelatedField(
        source='athlete',
        # Прямий імпорт безпечний: athletes.models → не імпортує tournaments.serializers.
        queryset=Athlete.objects.all(),
        write_only=True,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = Registration
        fields = [
            'id', 'athlete', 'athlete_id',
            'category', 'category_name',
            'seed_number', 'recorded_weight',
            'status', 'status_display',
            'created_at',
        ]
        read_only_fields = ['seed_number', 'recorded_weight', 'status', 'created_at']