"""Серіалайзери профілю спортсмена."""

from rest_framework import serializers

# Прямий імпорт безпечний: accounts.models не імпортує athletes.serializers,
# тому циклічної залежності немає.
from apps.accounts.models import Club
from apps.accounts.serializers import ClubSerializer, UserSerializer
from apps.athletes.models import Athlete, Team


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
    qr_token = serializers.SerializerMethodField()

    class Meta:
        model = Athlete
        fields = [
            "id",
            "first_name",
            "last_name",
            "patronymic",
            "full_name",
            "gender",
            "birth_date",
            "base_weight",
            "skill_level",
            "photo",
            "club",
            "club_id",
            "coach",
            "age",
            "qr_token",
        ]
        read_only_fields = ["coach"]

    def get_qr_token(self, obj):
        from django.core import signing

        signer = signing.Signer(salt="qr-verification")
        return signer.sign(f"ath:{obj.id}")

    def get_age(self, obj):
        return obj.calculate_current_age()

    def create(self, validated_data):
        # Тренер встановлюється автоматично з поточного запиту
        validated_data["coach"] = self.context["request"].user
        return super().create(validated_data)


class TeamSerializer(serializers.ModelSerializer):
    """Серіалайзер команди для групових категорій."""

    club = ClubSerializer(read_only=True)
    club_id = serializers.PrimaryKeyRelatedField(
        source="club",
        queryset=Club.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    coach = UserSerializer(read_only=True)
    athletes = AthleteSerializer(many=True, read_only=True)
    athlete_ids = serializers.PrimaryKeyRelatedField(
        source="athletes",
        queryset=Athlete.objects.all(),
        many=True,
        write_only=True,
    )

    class Meta:
        model = Team
        fields = [
            "id",
            "name",
            "club",
            "club_id",
            "coach",
            "athletes",
            "athlete_ids",
        ]
        read_only_fields = ["coach"]

    def validate(self, attrs):
        request = self.context.get("request")
        if request and request.user and request.user.role == "coach":
            athletes = attrs.get("athletes", [])
            for athlete in athletes:
                if athlete.coach != request.user:
                    msg = f"Спортсмен {athlete.get_full_name()} не належить вашому клубу."
                    raise serializers.ValidationError({"athlete_ids": msg})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user:
            validated_data["coach"] = request.user
            club_is_none = "club" not in validated_data or validated_data.get("club") is None
            if club_is_none and request.user.club:
                validated_data["club"] = request.user.club
        return super().create(validated_data)
