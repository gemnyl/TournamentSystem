"""
Серіалайзери підсистеми поєдинків.

MatchSerializer        — базовий (список матчів)
MatchDetailSerializer  — з розгорнутими учасниками
BracketNodeSerializer  — для передачі всього дерева сітки одним запитом
"""

from rest_framework import serializers

from apps.matches.models import Match
from apps.tournaments.serializers import RegistrationSerializer


class MatchSerializer(serializers.ModelSerializer):
    """Базовий серіалайзер поєдинку."""

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    win_method_display = serializers.CharField(source="get_win_method_display", read_only=True)
    reg_first = RegistrationSerializer(read_only=True)
    reg_second = RegistrationSerializer(read_only=True)

    class Meta:
        model = Match
        fields = [
            "id",
            "category",
            "reg_first",
            "reg_second",
            "round_index",
            "match_order",
            "tatami_number",
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
            "winner",
            "win_method",
            "win_method_display",
            "match_duration",
            "next_match",
            "status",
            "status_display",
            "started_at",
            "completed_at",
        ]
        read_only_fields = fields


class BracketNodeSerializer(serializers.Serializer):
    """Вузол дерева сітки — матч зі списком попередніх матчів.

    Використовується для побудови повного дерева єдиним запитом.
    Структура: список раундів, кожен раунд — список матчів.
    """

    round_index = serializers.IntegerField()
    matches = MatchSerializer(many=True)
