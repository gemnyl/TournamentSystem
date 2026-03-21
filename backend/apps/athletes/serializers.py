"""Серіалайзери профілю спортсмена."""
from rest_framework import serializers

from apps.accounts.serializers import ClubSerializer, UserSerializer
from apps.athletes.models import Athlete


class AthleteSerializer(serializers.ModelSerializer):
    """Повний серіалайзер спортсмена з вкладеними club та coach (read-only)."""

    club = ClubSerializer(read_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        source='club',
        queryset=__import__('apps.accounts.models', fromlist=['Club']).Club.objects.all(),
        write_only=True,
    )
    coach = UserSerializer(read_only=True)
    age = serializers.SerializerMethodField()

    class Meta:
        model = Athlete
        fields = [
            'id', 'first_name', 'last_name', 'gender',
            'birth_date', 'base_weight', 'skill_level',
            'club', 'club_id', 'coach', 'age',
        ]
        read_only_fields = ['coach']

    def get_age(self, obj):
        return obj.calculate_current_age()

    def create(self, validated_data):
        # Тренер встановлюється автоматично з поточного запиту
        validated_data['coach'] = self.context['request'].user
        return super().create(validated_data)