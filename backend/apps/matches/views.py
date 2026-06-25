"""
Views підсистеми поєдинків.

MatchViewSet:
    update_score  — POST /api/matches/{id}/update_score/   body: {corner, action_key}
    set_senshu    — POST /api/matches/{id}/set_senshu/     body: {value}
    set_winner    — POST /api/matches/{id}/set_winner/     body: {corner, win_method}
    bracket       — GET  /api/matches/bracket/?category={id}
"""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsJudgeOrOrganizer
from apps.common.broadcast import broadcast_match_event
from apps.matches.models import Match
from apps.matches.serializers import BracketNodeSerializer, MatchEventSerializer, MatchSerializer
from apps.matches.services.match_service import MatchService


class MatchViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Поєдинки — лише читання через стандартні list/retrieve.
    Усі зміни відбуваються через custom actions.
    """

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if obj.category.tournament.status == "completed":
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Турнір завершено. Зміни в поєдинках заборонені.")

    def get_queryset(self):
        qs = Match.objects.select_related(
            "category",
            "reg_first__athlete__club",
            "reg_second__athlete__club",
            "winner__athlete",
            "athlete_first__club",
            "athlete_second__club",
            "parent_team_match",
        ).prefetch_related(
            "team_bouts__athlete_first__club",
            "team_bouts__athlete_second__club",
        )
        category_id = self.request.query_params.get("category")
        if category_id:
            qs = qs.filter(category_id=category_id)
        tournament_id = self.request.query_params.get("tournament")
        if tournament_id:
            qs = qs.filter(category__tournament_id=tournament_id)
        tatami_number = self.request.query_params.get("tatami_number")
        if tatami_number:
            from django.db.models import Q

            qs = qs.filter(
                Q(tatami__number=tatami_number) | Q(parent_team_match__tatami__number=tatami_number)
            )
        parent_team_match = self.request.query_params.get("parent_team_match")
        if parent_team_match:
            return qs.filter(parent_team_match_id=parent_team_match).order_by("bout_index")
        return qs.order_by("category__schedule_order", "round_index", "match_order")

    def get_serializer_class(self):
        return MatchSerializer

    def get_permissions(self):
        judge_actions = (
            "update_score",
            "set_senshu",
            "set_winner",
            "set_draw",
            "reset_match",
            "timer_start",
            "timer_pause",
            "timer_resume",
            "timer_reset",
            "timer_set_duration",
            "timer_add_time",
            "submit_flags",
            "toggle_timer",
            "set_judges_count",
            "ruleset_event",
        )
        if self.action in judge_actions:
            return [IsJudgeOrOrganizer()]
        from rest_framework.permissions import AllowAny

        return [AllowAny()]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _execute_and_broadcast(self, match, action_func, *args, **kwargs):
        try:
            action_func(*args, **kwargs)
        except Exception as exc:
            from django.core.exceptions import ValidationError as DjangoValidationError
            from rest_framework.exceptions import ValidationError as DRFValidationError

            if isinstance(exc, ValueError | TypeError | DjangoValidationError | DRFValidationError):
                msg = exc.message if hasattr(exc, "message") else str(exc)
                return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
            raise exc
        match.refresh_from_db()
        last_event = match.events.order_by("-sequence").first()
        if last_event:
            broadcast_match_event(match, last_event)
        return Response(MatchSerializer(match).data)

    def _execute_service_action(self, match, action_func, *args, **kwargs):
        try:
            action_func(*args, **kwargs)
        except Exception as exc:
            from django.core.exceptions import ValidationError as DjangoValidationError

            if isinstance(exc, ValueError | TypeError | DjangoValidationError):
                msg = exc.message if hasattr(exc, "message") else str(exc)
                return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
            raise exc
        match.refresh_from_db()
        return Response(MatchSerializer(match).data)

    # ------------------------------------------------------------------
    # Ігрові дії
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="update_score")
    def update_score(self, request, pk=None):
        """POST /api/matches/{id}/update_score/
        Тіло: {"corner": "aka"|"ao", "action_key": "yuko"|..., "is_undo": bool}
        """
        match = self.get_object()
        corner = request.data.get("corner")
        action_key = request.data.get("action_key")
        is_undo = bool(request.data.get("is_undo", False))

        if not corner or not action_key:
            return Response(
                {"detail": "Поля 'corner' та 'action_key' є обов'язковими."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        svc = MatchService(match)
        return self._execute_and_broadcast(
            match, svc.apply_score, corner, action_key, judge=request.user, is_undo=is_undo
        )

    @action(detail=True, methods=["post"], url_path="ruleset_event")
    def ruleset_event(self, request, pk=None):
        """POST /api/matches/{id}/ruleset_event/
        Тіло: {"event_type": str, "payload": dict}
        """
        match = self.get_object()
        event_type = request.data.get("event_type")
        payload = request.data.get("payload")

        if not event_type:
            return Response(
                {"detail": "Поле 'event_type' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if payload is None:
            payload = {}

        svc = MatchService(match)
        return self._execute_and_broadcast(
            match, svc.apply_ruleset_event, event_type, payload, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="set_senshu")
    def set_senshu(self, request, pk=None):
        """POST /api/matches/{id}/set_senshu/
        Тіло: {"value": "aka"|"ao"|"none"}
        """
        match = self.get_object()
        value = request.data.get("value")

        if value is None:
            return Response(
                {"detail": "Поле 'value' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        svc = MatchService(match)
        return self._execute_and_broadcast(match, svc.set_senshu, value, judge=request.user)

    @action(detail=True, methods=["post"], url_path="set_winner")
    def set_winner(self, request, pk=None):
        """POST /api/matches/{id}/set_winner/
        Тіло: {"corner": "aka"|"ao", "win_method": "hantei"|"hansoku"|"kiken"|...}
        """
        match = self.get_object()
        corner = request.data.get("corner")
        win_method = request.data.get("win_method", Match.WinMethod.DECISION)

        if not corner:
            return Response(
                {"detail": "Поле 'corner' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        svc = MatchService(match)
        return self._execute_and_broadcast(
            match, svc.set_winner, corner, win_method, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="set_draw")
    def set_draw(self, request, pk=None):
        """POST /api/matches/{id}/set_draw/
        Тіло: {"win_method": "draw"}
        """
        match = self.get_object()
        win_method = request.data.get("win_method", Match.WinMethod.DRAW)
        svc = MatchService(match)
        return self._execute_service_action(match, svc.set_draw, win_method, judge=request.user)

    @action(detail=True, methods=["post"], url_path="reset_match")
    def reset_match(self, request, pk=None):
        """POST /api/matches/{id}/reset_match/"""
        match = self.get_object()
        svc = MatchService(match)
        return self._execute_service_action(match, svc.reset_match, judge=request.user)

    # ------------------------------------------------------------------
    # Сітка категорії (список раундів)
    # ------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="bracket")
    def bracket(self, request):
        """GET /api/matches/bracket/?category={id}
        Повертає всі матчі категорії, згрупованих по раундах.
        """
        category_id = request.query_params.get("category")
        if not category_id:
            return Response(
                {"detail": "Параметр category є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        matches = (
            Match.objects.filter(category_id=category_id, parent_team_match__isnull=True)
            .select_related(
                "reg_first__athlete__club",
                "reg_second__athlete__club",
                "winner__athlete",
            )
            .prefetch_related(
                "team_bouts__athlete_first__club",
                "team_bouts__athlete_second__club",
            )
            .order_by("round_index", "match_order")
        )

        rounds: dict[int, list] = {}
        for match in matches:
            rounds.setdefault(match.round_index, []).append(match)

        result = [
            {"round_index": round_idx, "matches": round_matches}
            for round_idx, round_matches in sorted(rounds.items())
        ]

        serializer = BracketNodeSerializer(result, many=True)
        return Response(serializer.data)

    # ------------------------------------------------------------------
    # Таймер
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="timer/start")
    def timer_start(self, request, pk=None):
        match = self.get_object()
        return self._execute_service_action(
            match, MatchService(match).timer_start, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="timer/pause")
    def timer_pause(self, request, pk=None):
        match = self.get_object()
        elapsed_ms = request.data.get("elapsed_ms")
        return self._execute_service_action(
            match, MatchService(match).timer_pause, elapsed_ms=elapsed_ms, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="timer/resume")
    def timer_resume(self, request, pk=None):
        match = self.get_object()
        return self._execute_service_action(
            match, MatchService(match).timer_resume, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="timer/reset")
    def timer_reset(self, request, pk=None):
        match = self.get_object()
        return self._execute_service_action(
            match, MatchService(match).timer_reset, judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="timer/set_duration")
    def timer_set_duration(self, request, pk=None):
        match = self.get_object()
        duration_ms = request.data.get("duration_ms")
        if duration_ms is None:
            return Response(
                {"detail": "Поле 'duration_ms' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return self._execute_service_action(
            match, MatchService(match).timer_set_duration, int(duration_ms), judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="timer/add_time")
    def timer_add_time(self, request, pk=None):
        match = self.get_object()
        delta_ms = request.data.get("delta_ms")
        if delta_ms is None:
            return Response(
                {"detail": "Поле 'delta_ms' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return self._execute_service_action(
            match, MatchService(match).timer_add_time, int(delta_ms), judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="submit_flags")
    def submit_flags(self, request, pk=None):
        """POST /api/matches/{id}/submit_flags/
        Тіло: {"flags_aka": int, "flags_ao": int}
        """
        match = self.get_object()
        flags_aka = request.data.get("flags_aka")
        flags_ao = request.data.get("flags_ao")
        if flags_aka is None or flags_ao is None:
            return Response(
                {"detail": "Поля 'flags_aka' та 'flags_ao' є обов'язковими."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return self._execute_service_action(
            match,
            MatchService(match).submit_flags_decision,
            int(flags_aka),
            int(flags_ao),
            judge=request.user,
        )

    @action(detail=True, methods=["post"], url_path="toggle_timer")
    def toggle_timer(self, request, pk=None):
        """POST /api/matches/{id}/toggle_timer/
        Тіло: {"show_timer": bool}
        """
        match = self.get_object()
        show_timer = request.data.get("show_timer")
        if show_timer is None:
            return Response(
                {"detail": "Поле 'show_timer' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return self._execute_service_action(
            match, MatchService(match).toggle_timer, bool(show_timer), judge=request.user
        )

    @action(detail=True, methods=["post"], url_path="set_judges_count")
    def set_judges_count(self, request, pk=None):
        """POST /api/matches/{id}/set_judges_count/
        Тіло: {"judges_count": int}
        """
        match = self.get_object()
        judges_count = request.data.get("judges_count")
        if judges_count is None:
            return Response(
                {"detail": "Поле 'judges_count' є обов'язковим."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return self._execute_service_action(
            match, MatchService(match).set_judges_count, int(judges_count), judge=request.user
        )

    @action(detail=True, methods=["get"], url_path="events")
    def events(self, request, pk=None):
        """GET /api/matches/{id}/events/
        Returns list of MatchEvent objects for this match
        """
        match = self.get_object()
        events = match.events.all().order_by("sequence")
        serializer = MatchEventSerializer(events, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="assign_bout_athletes")
    def assign_bout_athletes(self, request, pk=None):
        """POST /api/matches/{id}/assign_bout_athletes/
        Тіло: {"athlete_first_id": int | null, "athlete_second_id": int | null}
        """
        match = self.get_object()
        if not match.parent_team_match:
            return Response(
                {
                    "detail": (
                        "Призначити спортсменів можна лише для "
                        "індивідуального бою командного матчу."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        athlete_first_id = request.data.get("athlete_first_id")
        athlete_second_id = request.data.get("athlete_second_id")

        from apps.athletes.models import Athlete

        if athlete_first_id:
            try:
                match.athlete_first = Athlete.objects.get(id=athlete_first_id)
            except Athlete.DoesNotExist:
                return Response(
                    {"detail": "Атлета Aka не знайдено."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            match.athlete_first = None

        if athlete_second_id:
            try:
                match.athlete_second = Athlete.objects.get(id=athlete_second_id)
            except Athlete.DoesNotExist:
                return Response(
                    {"detail": "Атлета Ao не знайдено."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            match.athlete_second = None

        match.save()

        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(match)

        # Оновимо також батьківський матч для синхронізації
        broadcast_match_update(match.parent_team_match)

        serializer = self.get_serializer(match)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="spawn_extra_bout")
    def spawn_extra_bout(self, request, pk=None):
        """POST /api/matches/{id}/spawn_extra_bout/"""
        match = self.get_object()
        if match.parent_team_match or not match.category.is_team:
            return Response(
                {
                    "detail": (
                        "Додатковий бій можна створити лише для батьківського командного матчу."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Рахуємо скільки боїв уже є
        existing_bouts_count = match.team_bouts.count()

        extra_bout = Match.objects.create(
            category=match.category,
            parent_team_match=match,
            round_index=match.round_index,
            match_order=match.match_order,
            bout_index=existing_bouts_count + 1,
            timer_duration_ms=match.timer_duration_ms,
            status=Match.Status.SCHEDULED,
        )

        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(match)

        serializer = self.get_serializer(extra_bout)
        return Response(serializer.data)
