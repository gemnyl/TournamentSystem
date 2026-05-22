from rest_framework import serializers

from apps.tatamis.models import Tatami


class TatamiSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tatami
        fields = ["id", "tournament", "number", "name", "current_match", "is_active"]
        read_only_fields = ["id"]
