"""
Views для спортсменів.

Тренер бачить лише своїх спортсменів.
Організатор / адмін — усіх.
"""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.athletes.models import Athlete
from apps.athletes.serializers import AthleteSerializer


class AthleteViewSet(viewsets.ModelViewSet):
    """CRUD спортсменів з автоматичним фільтром за роллю тренера."""

    serializer_class = AthleteSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Athlete.objects.select_related("club", "coach").all()
        # Тренер бачить лише своїх
        if user.role == "coach":
            qs = qs.filter(coach=user)
        return qs

    def get_permissions(self):
        # Запис — тренери, організатори та адміни
        if self.action in ("create", "update", "partial_update", "destroy"):
            from rest_framework.permissions import BasePermission

            class IsCoachOrOrganizer(BasePermission):
                def has_permission(self, request, view):
                    return bool(
                        request.user
                        and request.user.is_authenticated
                        and request.user.role in ("coach", "organizer", "admin")
                    )

            return [IsCoachOrOrganizer()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        user = self.request.user
        club = serializer.validated_data.get("club")

        # Якщо клуб не передано, а користувач є тренером із призначеним клубом, використовуємо його
        if not club and user.role == "coach" and hasattr(user, "club") and user.club:
            club = user.club
            serializer.validated_data["club"] = club

        # Якщо після цього клуб все ще не визначено, повертаємо помилку валідації
        if not serializer.validated_data.get("club"):
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"club_id": "Вкажіть клуб або призначте клуб тренеру."})

        serializer.save()
