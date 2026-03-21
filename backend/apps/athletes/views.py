"""
Views для спортсменів.

Тренер бачить лише своїх спортсменів.
Організатор / адмін — усіх.
"""
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.accounts.permissions import IsCoach
from apps.athletes.models import Athlete
from apps.athletes.serializers import AthleteSerializer


class AthleteViewSet(viewsets.ModelViewSet):
    """CRUD спортсменів з автоматичним фільтром за роллю тренера."""

    serializer_class = AthleteSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Athlete.objects.select_related('club', 'coach').all()
        # Тренер бачить лише своїх
        if user.role == 'coach':
            qs = qs.filter(coach=user)
        return qs

    def get_permissions(self):
        # Запис — лише тренери та адміни
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsCoach()]
        return [IsAuthenticated()]