from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.rulesets.registry import list_rulesets


@api_view(["GET"])
@permission_classes([AllowAny])
def ruleset_list(request):
    """GET /api/rulesets/ — повертає список зареєстрованих рулсетів."""
    return Response(list_rulesets())
