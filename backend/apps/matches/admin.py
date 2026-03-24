"""Адмін-панель для поєдинків."""
from django.contrib import admin

from apps.matches.models import Match


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display  = [
        'id', 'category', 'round_index', 'match_order',
        'reg_first', 'reg_second',
        'score_first', 'score_second',
        'winner', 'win_method', 'status',
    ]
    list_filter   = ['status', 'win_method', 'category__tournament']
    search_fields = [
        'category__name',
        'reg_first__athlete__last_name',
        'reg_second__athlete__last_name',
    ]
    ordering = ['category', 'round_index', 'match_order']
    readonly_fields = ['started_at', 'completed_at']
    raw_id_fields   = ['category', 'reg_first', 'reg_second', 'winner', 'next_match']

    fieldsets = (
        ('Позиція у сітці', {
            'fields': ('category', 'round_index', 'match_order', 'tatami_number', 'next_match')
        }),
        ('Учасники', {
            'fields': ('reg_first', 'reg_second')
        }),
        ('Рахунок', {
            'fields': (
                'score_first', 'score_second',
                'warnings_first', 'warnings_second',
            )
        }),
        ('Результат', {
            'fields': ('winner', 'win_method', 'match_duration', 'status')
        }),
        ('Часові мітки', {
            'fields': ('started_at', 'completed_at'),
        }),
    )