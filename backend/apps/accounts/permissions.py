"""
Класи дозволів (permissions) для рольової моделі доступу.

Використовуються у view-класах для обмеження операцій
залежно від ролі автентифікованого користувача.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsOrganizer(BasePermission):
    """Дозволяє доступ лише користувачам з роллю ORGANIZER або ADMIN."""

    message = "Доступ лише для організаторів турнірів."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("organizer", "admin")
        )


class IsCoach(BasePermission):
    """Дозволяє доступ лише тренерам та адміністраторам."""

    message = "Доступ лише для тренерів."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("coach", "admin")
        )


class IsJudge(BasePermission):
    """Дозволяє доступ суддям та адміністраторам."""

    message = "Доступ лише для суддів."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("judge", "admin")
        )


class IsOwnerOrReadOnly(BasePermission):
    """Запис — лише власнику об'єкта; читання — будь-якому автентифікованому."""

    message = "Редагування дозволено лише власнику."

    def has_object_permission(self, request, view, obj):
        # Безпечні методи (GET, HEAD, OPTIONS) — для всіх
        if request.method in SAFE_METHODS:
            return True

        # Запис — лише якщо об'єкт «належить» поточному користувачу.
        # Підтримуємо атрибути owner, organizer, coach, user.
        owner = (
            getattr(obj, "owner", None)
            or getattr(obj, "organizer", None)
            or getattr(obj, "coach", None)
            or getattr(obj, "user", None)
        )

        return owner == request.user


class IsOrganizerOrReadOnly(BasePermission):
    """Запис — лише організаторам; читання — усім автентифікованим."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("organizer", "admin")
        )


class IsJudgeOrOrganizer(BasePermission):
    """Дозволяє доступ суддям, організаторам та адміністраторам."""

    message = "Доступ лише для суддів та організаторів."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("judge", "organizer", "admin")
        )


class IsCoachOrOrganizer(BasePermission):
    """Дозволяє доступ тренерам, організаторам та адміністраторам."""

    message = "Доступ лише для тренерів та організаторів."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("coach", "organizer", "admin")
        )


class BaseTournamentPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.role == "admin":
            return True

        # Check if we can resolve the tournament from payload/query parameters
        tournament_id = None
        if request.method == "POST":
            tournament_id = request.data.get("tournament") or request.data.get("tournament_id")
            if not tournament_id:
                category_id = request.data.get("category") or request.data.get("category_id")
                if category_id:
                    from apps.tournaments.models import Category

                    try:
                        category = Category.objects.get(pk=category_id)
                        tournament_id = category.tournament_id
                    except Category.DoesNotExist:
                        pass
                else:
                    match_id = request.data.get("match") or request.data.get("match_id")
                    if match_id:
                        from apps.matches.models import Match

                        try:
                            match_obj = Match.objects.get(pk=match_id)
                            tournament_id = match_obj.category.tournament_id
                        except Match.DoesNotExist:
                            pass
        else:
            tournament_id = request.query_params.get("tournament") or request.query_params.get(
                "tournament_id"
            )

        if tournament_id:
            from apps.tournaments.models import Tournament

            try:
                tournament = Tournament.objects.get(pk=tournament_id)
                # Check organizer
                if tournament.organizer == request.user:
                    return True
                # Check custom logic
                return self.has_tournament_permission(request, tournament)
            except Tournament.DoesNotExist:
                pass

        return True

    def _get_tournament(self, obj):
        from apps.matches.models import Match
        from apps.tournaments.models import Category, Registration, Tournament

        if isinstance(obj, Tournament):
            return obj
        if isinstance(obj, Category):
            return obj.tournament
        if isinstance(obj, Registration):
            return obj.category.tournament
        if isinstance(obj, Match):
            return obj.category.tournament
        if hasattr(obj, "tournament"):
            return obj.tournament
        return None

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.role == "admin":
            return True

        tournament = self._get_tournament(obj)
        if tournament is None:
            return False

        # Is organizer?
        if tournament.organizer == request.user:
            return True

        return self.has_tournament_permission(request, tournament)

    def has_tournament_permission(self, request, tournament) -> bool:
        raise NotImplementedError()


class IsTournamentStaffOrOrganizer(BaseTournamentPermission):
    """
    Дозволяє доступ організатору турніру, призначеному персоналу
    (staff_members) або адміністраторам.
    """

    message = "Доступ лише для організатора, персоналу турніру або адміністратора."

    def has_tournament_permission(self, request, tournament) -> bool:
        # Is in staff members?
        if tournament.staff_members.filter(id=request.user.id).exists():
            return True

        # Is chief judge?
        if tournament.chief_judge == request.user:
            return True

        return False


class IsTournamentChiefJudgeOrOrganizer(BaseTournamentPermission):
    """
    Дозволяє доступ організатору турніру, головному судді турніру або адміністраторам.
    """

    message = "Доступ лише для організатора, головного судді турніру або адміністратора."

    def has_tournament_permission(self, request, tournament) -> bool:
        # Is chief judge?
        if tournament.chief_judge == request.user:
            return True

        return False
