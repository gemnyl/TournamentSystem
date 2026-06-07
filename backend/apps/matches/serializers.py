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
    ruleset_key = serializers.CharField(source="category.ruleset_key", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_order = serializers.IntegerField(source="category.schedule_order", read_only=True)
    judging_mode = serializers.SerializerMethodField()

    def get_judging_mode(self, obj):
        from apps.rulesets.registry import get_ruleset

        try:
            return get_ruleset(obj.category.ruleset_key).judging_mode
        except KeyError:
            return None

    class Meta:
        model = Match
        fields = [
            "id",
            "category",
            "reg_first",
            "reg_second",
            "round_index",
            "match_order",
            "tatami",
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
            "winner",
            "win_method",
            "win_method_display",
            "senshu",
            "flags_aka",
            "flags_ao",
            "judges_count",
            "match_duration",
            "next_match",
            "status",
            "status_display",
            "started_at",
            "completed_at",
            "timer_status",
            "timer_started_at",
            "timer_elapsed_ms",
            "timer_duration_ms",
            "ruleset_key",
            "category_name",
            "judging_mode",
            "category_order",
            "show_timer",
        ]
        read_only_fields = fields


class BracketNodeSerializer(serializers.Serializer):
    """Вузол дерева сітки — матч зі списком попередніх матчів.

    Використовується для побудови повного дерева єдиним запитом.
    Структура: список раундів, кожен раунд — список матчів.
    """

    round_index = serializers.IntegerField()
    matches = MatchSerializer(many=True)
