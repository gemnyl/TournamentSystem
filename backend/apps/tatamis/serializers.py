from rest_framework import serializers

from apps.tatamis.models import Tatami


class TatamiSerializer(serializers.ModelSerializer):
    matches_count = serializers.SerializerMethodField()
    current_match = serializers.SerializerMethodField()
    assigned_judge_name = serializers.CharField(
        source="assigned_judge.get_full_name", read_only=True
    )

    class Meta:
        model = Tatami
        fields = [
            "id",
            "tournament",
            "number",
            "name",
            "current_match",
            "is_active",
            "matches_count",
            "assigned_judge",
            "assigned_judge_name",
        ]
        read_only_fields = ["id"]

    def get_matches_count(self, obj):
        return obj.tatami_matches.filter(status__in=["scheduled", "ongoing"]).count()

    def get_current_match(self, obj):
        if not obj.current_match:
            return None
        from apps.matches.serializers import MatchSerializer

        return MatchSerializer(obj.current_match).data
