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


class BaseTournamentAdminMixin:
    """
    Mixin class that provides common module-level and object-level permissions
    for tournament-related ModelAdmins.
    """

    def has_module_permission(self, request):
        if not request.user or not request.user.is_authenticated:
            return False
        from django.contrib.auth import get_user_model

        User = get_user_model()
        return request.user.is_superuser or request.user.role in (
            User.Role.ADMIN,
            User.Role.ORGANIZER,
            User.Role.JUDGE,
        )

    def _resolve_tournament(self, obj):
        if obj is None:
            return None
        # If obj is already a Tournament
        if (
            hasattr(obj, "organizer")
            and hasattr(obj, "chief_judge")
            and not hasattr(obj, "tournament")
        ):
            return obj
        # Try different paths to tournament depending on object type
        if hasattr(obj, "tournament"):
            return obj.tournament
        if hasattr(obj, "category") and hasattr(obj.category, "tournament"):
            return obj.category.tournament
        if (
            hasattr(obj, "match")
            and hasattr(obj.match, "category")
            and hasattr(obj.match.category, "tournament")
        ):
            return obj.match.category.tournament
        return None

    def has_change_permission(self, request, obj=None):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if request.user.role == User.Role.ADMIN:
            return True
        if obj is None:
            return request.user.role in (User.Role.ORGANIZER, User.Role.JUDGE)

        tournament = self._resolve_tournament(obj)
        if tournament is None:
            return False
        return tournament.organizer == request.user or tournament.chief_judge == request.user

    def has_delete_permission(self, request, obj=None):
        return self.has_change_permission(request, obj)

    def has_add_permission(self, request):
        if not request.user or not request.user.is_authenticated:
            return False
        from django.contrib.auth import get_user_model

        User = get_user_model()
        return request.user.is_superuser or request.user.role in (
            User.Role.ADMIN,
            User.Role.ORGANIZER,
            User.Role.JUDGE,
        )
