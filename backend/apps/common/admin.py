import psutil
from django.contrib.auth import get_user_model
from django.db import connection, connections

from apps.accounts.models import RoleRequest
from apps.matches.models import Match
from apps.tournaments.models import Tournament

User = get_user_model()


def dashboard_callback(request, context):
    """
    Injects key metrics and system health indicators into the Admin dashboard.
    Optimized for speed: cpu_percent(interval=None) is non-blocking to prevent load delays.
    """
    # 1. Performance-critical counters (Aggregate queries)
    # Cacheable in the future using Redis cache backend (django.core.cache)
    active_tournaments_count = Tournament.objects.filter(status=Tournament.Status.ACTIVE).count()
    pending_role_requests_count = RoleRequest.objects.filter(
        status=RoleRequest.Status.PENDING
    ).count()
    ongoing_matches_count = Match.objects.filter(status=Match.Status.ONGOING).count()

    total_users_count = User.objects.count()
    total_tournaments_count = Tournament.objects.count()

    # 2. System utilization metrics (via non-blocking psutil)
    try:
        cpu_usage = psutil.cpu_percent(interval=None)
        ram_usage = psutil.virtual_memory().percent
    except Exception:
        cpu_usage = 0.0
        ram_usage = 0.0

    # 3. Database connection pool tracking
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM pg_stat_activity;")
            db_connections = cursor.fetchone()[0]
    except Exception:
        db_connections = len(connections.all())

    # Update template context dictionary
    context.update(
        {
            "active_tournaments_count": active_tournaments_count,
            "pending_role_requests_count": pending_role_requests_count,
            "ongoing_matches_count": ongoing_matches_count,
            "total_users_count": total_users_count,
            "total_tournaments_count": total_tournaments_count,
            "cpu_usage": cpu_usage,
            "ram_usage": ram_usage,
            "db_connections": db_connections,
        }
    )

    return context
