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
