"""Серіалайзери профілю спортсмена."""

from rest_framework import serializers

# Прямий імпорт безпечний: accounts.models не імпортує athletes.serializers,
# тому циклічної залежності немає.
from apps.accounts.models import Club
from apps.accounts.serializers import ClubSerializer, UserSerializer
from apps.athletes.models import Athlete


class AthleteSerializer(serializers.ModelSerializer):
    """Повний серіалайзер спортсмена з вкладеними club та coach (read-only)."""

    club = ClubSerializer(read_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        source="club",
        queryset=Club.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    coach = UserSerializer(read_only=True)
    age = serializers.SerializerMethodField()
    full_name = serializers.CharField(source="get_full_name", read_only=True)

    class Meta:
        model = Athlete
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "gender",
            "birth_date",
            "base_weight",
            "skill_level",
            "club",
            "club_id",
            "coach",
            "age",
        ]
        read_only_fields = ["coach"]

    def get_age(self, obj):
        return obj.calculate_current_age()

    def create(self, validated_data):
        # Тренер встановлюється автоматично з поточного запиту
        validated_data["coach"] = self.context["request"].user
        return super().create(validated_data)
