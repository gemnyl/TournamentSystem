"""
Серіалайзери підсистеми поєдинків.

MatchSerializer        — базовий (список матчів)
MatchDetailSerializer  — з розгорнутими учасниками
BracketNodeSerializer  — для передачі всього дерева сітки одним запитом
"""

from rest_framework import serializers

from apps.athletes.serializers import AthleteSerializer
from apps.matches.models import Match, MatchEvent
from apps.tournaments.serializers import RegistrationSerializer


class TeamBoutSerializer(serializers.ModelSerializer):
    athlete_first = AthleteSerializer(read_only=True)
    athlete_second = AthleteSerializer(read_only=True)
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
            "bout_index",
            "athlete_first",
            "athlete_second",
            "score_first",
            "score_second",
            "status",
            "winner",
            "win_method",
            "flags_aka",
            "flags_ao",
            "judging_mode",
            "timer_status",
            "timer_elapsed_ms",
            "timer_duration_ms",
            "show_timer",
        ]


class MatchSerializer(serializers.ModelSerializer):
    """Базовий серіалайзер поєдинку."""

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    win_method_display = serializers.CharField(source="get_win_method_display", read_only=True)
    reg_first = RegistrationSerializer(read_only=True)
    reg_second = RegistrationSerializer(read_only=True)
    athlete_first = AthleteSerializer(read_only=True)
    athlete_second = AthleteSerializer(read_only=True)
    ruleset_key = serializers.CharField(source="category.ruleset_key", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_order = serializers.IntegerField(source="category.schedule_order", read_only=True)
    category_is_team = serializers.BooleanField(source="category.is_team", read_only=True)
    tournament_id = serializers.IntegerField(source="category.tournament_id", read_only=True)
    tournament_title = serializers.CharField(source="category.tournament.title", read_only=True)
    tatami_number = serializers.SerializerMethodField()
    judging_mode = serializers.SerializerMethodField()
    team_bouts = serializers.SerializerMethodField()

    def get_tatami_number(self, obj):
        if obj.tatami:
            return obj.tatami.number
        if obj.parent_team_match and obj.parent_team_match.tatami:
            return obj.parent_team_match.tatami.number
        return None

    is_team_bouts_supported = serializers.SerializerMethodField()

    def get_judging_mode(self, obj):
        from apps.rulesets.registry import get_ruleset

        try:
            return get_ruleset(obj.category.ruleset_key).judging_mode
        except KeyError:
            return None

    def get_team_bouts(self, obj):
        if obj.parent_team_match_id is not None:
            return []
        bouts = obj.team_bouts.all().order_by("bout_index")
        return TeamBoutSerializer(bouts, many=True).data

    def get_is_team_bouts_supported(self, obj):
        from apps.rulesets.registry import get_ruleset

        try:
            return get_ruleset(obj.category.ruleset_key).is_team_bouts_supported()
        except KeyError:
            return False

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
            "parent_team_match",
            "athlete_first",
            "athlete_second",
            "bout_index",
            "category_is_team",
            "team_bouts",
            "is_team_bouts_supported",
            "tournament_id",
            "tournament_title",
            "tatami_number",
        ]
        read_only_fields = fields


class BracketNodeSerializer(serializers.Serializer):
    """Вузол дерева сітки — матч зі списком попередніх матчів.

    Використовується для побудови повного дерева єдиним запитом.
    Структура: список раундів, кожен раунд — список матчів.
    """

    round_index = serializers.IntegerField()
    matches = MatchSerializer(many=True)


class MatchEventSerializer(serializers.ModelSerializer):
    """Серіалайзер події поєдинку."""

    class Meta:
        model = MatchEvent
        fields = [
            "id",
            "match",
            "sequence",
            "event_type",
            "payload",
            "judge",
            "created_at",
        ]
