from dataclasses import replace

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.matches.models import Match, MatchEvent
from apps.rulesets.base import MatchState, ScoreEvent


def _broadcast_timer(match: Match) -> None:
    from apps.common.broadcast import broadcast_timer_state

    transaction.on_commit(lambda: broadcast_timer_state(match))


class MatchService:
    """Координує зміни стану матчу: ruleset → MatchEvent → Match."""

    def __init__(self, match: Match):
        self.match = match
        self._ruleset = None

    @property
    def ruleset(self):
        if self._ruleset is None:
            from apps.rulesets.registry import get_ruleset

            self._ruleset = get_ruleset(self.match.category.ruleset_key)
        return self._ruleset

    def _build_state(self) -> MatchState:
        m = self.match
        return MatchState(
            score_aka=m.score_first,
            score_ao=m.score_second,
            warnings_aka=m.warnings_first,
            warnings_ao=m.warnings_second,
            senshu=m.senshu,
            flags_aka=m.flags_aka,
            flags_ao=m.flags_ao,
            judges_count=m.judges_count,
        )

    def _next_sequence(self) -> int:
        agg = self.match.events.aggregate(Max("sequence"))
        return (agg["sequence__max"] or 0) + 1

    def _write_event(self, event_type: str, payload: dict, judge=None) -> MatchEvent:
        return MatchEvent.objects.create(
            match=self.match,
            sequence=self._next_sequence(),
            event_type=event_type,
            payload=payload,
            judge=judge,
        )

    @transaction.atomic
    def apply_score(self, corner: str, action_key: str, judge=None, is_undo=False) -> Match:
        """Застосовує ігрову подію (бал або попередження) через активний рулсет або скасовує її."""
        m = self.match
        if corner not in ("aka", "ao"):
            raise ValueError(f"Invalid corner: '{corner}'. Must be 'aka' or 'ao'.")

        actions = {a.key: a for a in self.ruleset.get_score_actions()}
        action = actions.get(action_key)
        if action is None:
            raise ValueError(f"Unknown action_key: '{action_key}'.")

        if is_undo:
            if action.is_warning:
                if corner == "aka":
                    m.warnings_first = max(0, m.warnings_first - 1)
                else:
                    m.warnings_second = max(0, m.warnings_second - 1)
            else:
                if corner == "aka":
                    m.score_first = max(0, m.score_first - action.points)
                else:
                    m.score_second = max(0, m.score_second - action.points)

            update_fields = [
                "score_first",
                "score_second",
                "warnings_first",
                "warnings_second",
            ]

            # Автоматичне скидання сеншу для WKF при обнуленні рахунку
            if m.category.ruleset_key == "karate_wkf" and m.senshu == corner:
                if m.score_first == 0 and m.score_second == 0:
                    m.senshu = Match.Senshu.NONE
                    update_fields.append("senshu")
                if m.next_match:
                    nxt = m.next_match
                    nxt_updated = False
                    if m.winner == nxt.reg_first:
                        nxt.reg_first = None
                        nxt_updated = True
                    elif m.winner == nxt.reg_second:
                        nxt.reg_second = None
                        nxt_updated = True
                    if nxt_updated:
                        nxt.save(update_fields=["reg_first", "reg_second"])
                        from apps.common.broadcast import broadcast_match_update

                        broadcast_match_update(nxt)

                m.status = Match.Status.ONGOING
                m.winner = None
                m.win_method = ""
                m.completed_at = None
                update_fields += ["status", "winner", "win_method", "completed_at"]

            m.save(update_fields=update_fields)

            event_type = (
                MatchEvent.EventType.WARNING if action.is_warning else MatchEvent.EventType.SCORE
            )
            self._write_event(
                event_type, {"corner": corner, "action_key": action_key, "is_undo": True}, judge
            )

            return m

        else:
            state = self._build_state()
            score_event = ScoreEvent(corner=corner, action_key=action_key)
            new_state = self.ruleset.apply_score_event(state, score_event)

            # Автоматичне призначення сеншу для карате WKF за перший набраний бал
            if m.category.ruleset_key == "karate_wkf" and state.senshu == "none":
                actions = {a.key: a for a in self.ruleset.get_score_actions()}
                act = actions.get(action_key)
                if act and not act.is_warning and act.points > 0:
                    if state.score_aka == 0 and state.score_ao == 0:
                        new_state = replace(new_state, senshu=corner)

            new_state = self.ruleset.check_auto_finish(new_state)

            m.score_first = new_state.score_aka
            m.score_second = new_state.score_ao
            m.warnings_first = new_state.warnings_aka
            m.warnings_second = new_state.warnings_ao

            old_senshu = m.senshu
            m.senshu = new_state.senshu

            if m.status == Match.Status.SCHEDULED:
                m.status = Match.Status.ONGOING

            update_fields = [
                "score_first",
                "score_second",
                "warnings_first",
                "warnings_second",
                "status",
            ]
            if m.senshu != old_senshu:
                update_fields.append("senshu")

            if new_state.is_finished:
                winner_reg = m.reg_first if new_state.winner == "aka" else m.reg_second
                m.winner = winner_reg
                m.win_method = new_state.win_method
                m.status = Match.Status.COMPLETED
                m.completed_at = timezone.now()

                # Примусово зупиняємо таймер при авто-завершенні
                m.timer_status = Match.TimerStatus.PAUSED
                m.timer_started_at = None
                update_fields += [
                    "winner",
                    "win_method",
                    "completed_at",
                    "timer_status",
                    "timer_started_at",
                ]

                m.save(update_fields=update_fields)
                m.advance_participant()
            else:
                m.save(update_fields=update_fields)

            event_type = (
                MatchEvent.EventType.WARNING if action.is_warning else MatchEvent.EventType.SCORE
            )
            self._write_event(event_type, {"corner": corner, "action_key": action_key}, judge)

            return m

    @transaction.atomic
    def set_senshu(self, value: str, judge=None) -> Match:
        """Встановлює senshu (перша атака) для 'aka', 'ao' або скидає на 'none'."""
        valid = {c[0] for c in Match.Senshu.choices}
        if value not in valid:
            raise ValueError(f"Invalid senshu value: '{value}'. Must be one of {valid}.")

        m = self.match
        m.senshu = value
        m.save(update_fields=["senshu"])

        self._write_event(MatchEvent.EventType.SENSHU, {"value": value}, judge)
        return m

    @transaction.atomic
    def timer_start(self, judge=None) -> Match:
        m = self.match
        if m.timer_status != Match.TimerStatus.NOT_STARTED:
            raise ValueError("Таймер вже запущено або завершено.")
        m.timer_started_at = timezone.now()
        m.timer_status = Match.TimerStatus.RUNNING
        m.save(update_fields=["timer_started_at", "timer_status"])
        self._write_event(MatchEvent.EventType.TIMER_START, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_pause(self, elapsed_ms=None, judge=None) -> Match:
        m = self.match
        if m.timer_status != Match.TimerStatus.RUNNING:
            raise ValueError("Таймер не запущено.")

        server_delta = int((timezone.now() - m.timer_started_at).total_seconds() * 1000)
        calculated_elapsed = m.timer_elapsed_ms + server_delta

        if elapsed_ms is not None:
            try:
                client_elapsed = int(elapsed_ms)
                # Безпекова перевірка: відхилення від сервера не має перевищувати 5 секунд
                if abs(calculated_elapsed - client_elapsed) < 5000:
                    m.timer_elapsed_ms = client_elapsed
                else:
                    m.timer_elapsed_ms = calculated_elapsed
            except (ValueError, TypeError):
                m.timer_elapsed_ms = calculated_elapsed
        else:
            m.timer_elapsed_ms = calculated_elapsed

        m.timer_started_at = None
        m.timer_status = Match.TimerStatus.PAUSED
        m.save(update_fields=["timer_elapsed_ms", "timer_started_at", "timer_status"])
        self._write_event(MatchEvent.EventType.TIMER_PAUSE, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_resume(self, judge=None) -> Match:
        m = self.match
        if m.timer_status != Match.TimerStatus.PAUSED:
            raise ValueError("Таймер не на паузі.")
        m.timer_started_at = timezone.now()
        m.timer_status = Match.TimerStatus.RUNNING
        m.save(update_fields=["timer_started_at", "timer_status"])
        self._write_event(MatchEvent.EventType.TIMER_RESUME, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_reset(self, judge=None) -> Match:
        m = self.match
        m.timer_status = Match.TimerStatus.NOT_STARTED
        m.timer_elapsed_ms = 0
        m.timer_started_at = None
        m.save(update_fields=["timer_status", "timer_elapsed_ms", "timer_started_at"])
        self._write_event(MatchEvent.EventType.TIMER_RESET, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_set_duration(self, duration_ms: int, judge=None) -> Match:
        m = self.match
        if m.timer_status == Match.TimerStatus.RUNNING:
            raise ValueError("Не можна змінювати тривалість під час бою.")
        m.timer_duration_ms = duration_ms
        m.save(update_fields=["timer_duration_ms"])
        self._write_event(MatchEvent.EventType.TIMER_SET_DUR, {"duration_ms": duration_ms}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_add_time(self, delta_ms: int, judge=None) -> Match:
        m = self.match
        if m.timer_status == Match.TimerStatus.RUNNING:
            raise ValueError("Не можна змінювати тривалість під час бою.")
        new_duration = m.timer_duration_ms + delta_ms
        if new_duration < 0:
            raise ValueError("Тривалість не може бути від'ємною")
        m.timer_duration_ms = max(m.timer_elapsed_ms, new_duration)
        m.save(update_fields=["timer_duration_ms"])
        self._write_event(MatchEvent.EventType.TIMER_SET_DUR, {"delta_ms": delta_ms}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def set_winner(self, corner: str, win_method: str, judge=None) -> Match:
        """Вручну фіксує переможця (hantei, kiken тощо)."""
        if corner not in ("aka", "ao"):
            raise ValueError(f"Invalid corner: '{corner}'. Must be 'aka' or 'ao'.")

        m = self.match
        winner_reg = m.reg_first if corner == "aka" else m.reg_second
        if winner_reg is None:
            raise ValueError(f"No participant registered in corner '{corner}'.")

        m.set_winner(winner_reg, win_method)

        self._write_event(
            MatchEvent.EventType.FINISH,
            {"corner": corner, "win_method": win_method},
            judge,
        )
        return m

    @transaction.atomic
    def set_draw(self, win_method="draw", judge=None) -> Match:
        """Вручну встановлює нічию (лише для кругового формату)."""
        m = self.match
        if m.category.bracket_format != "round_robin":
            raise ValidationError("Нічия дозволена тільки в круговому форматі.")

        m.winner = None
        m.win_method = win_method
        m.status = Match.Status.COMPLETED
        m.completed_at = timezone.now()
        m.save(update_fields=["winner", "win_method", "status", "completed_at"])

        event = self._write_event(
            MatchEvent.EventType.FINISH,
            {"win_method": win_method},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    def can_reset_match(self) -> tuple[bool, str]:
        """Перевіряє, чи можна безпечно скинути поєдинок."""
        m = self.match
        if not m.next_match:
            return True, ""

        nxt = m.next_match
        if nxt.status != Match.Status.SCHEDULED:
            return (
                False,
                "Не можна скинути бій, оскільки наступний поєдинок уже розпочався або заверсився.",
            )

        if (
            nxt.score_first > 0
            or nxt.score_second > 0
            or nxt.warnings_first > 0
            or nxt.warnings_second > 0
        ):
            return (
                False,
                "Не можна скинути бій, оскільки в наступному "
                "поєдинку вже є набрані бали або попередження.",
            )

        return True, ""

    @transaction.atomic
    def reset_match(self, judge=None) -> Match:
        """Повністю скидає стан поєдинку, з каскадним видаленням переможця з наступного бою."""
        m = self.match
        can_reset, error_msg = self.can_reset_match()
        if not can_reset:
            raise ValidationError(error_msg)

        if m.next_match:
            nxt = m.next_match
            nxt_updated = False
            if m.winner == nxt.reg_first:
                nxt.reg_first = None
                nxt_updated = True
            elif m.winner == nxt.reg_second:
                nxt.reg_second = None
                nxt_updated = True
            if nxt_updated:
                nxt.save(update_fields=["reg_first", "reg_second"])
                from apps.common.broadcast import broadcast_match_update

                broadcast_match_update(nxt)

        m.score_first = 0
        m.score_second = 0
        m.warnings_first = 0
        m.warnings_second = 0
        m.senshu = Match.Senshu.NONE
        m.winner = None
        m.win_method = ""
        m.status = Match.Status.SCHEDULED
        m.timer_status = Match.TimerStatus.NOT_STARTED
        m.timer_elapsed_ms = 0
        m.timer_started_at = None
        m.completed_at = None
        m.started_at = None

        # Скидаємо тривалість таймера до значення категорії або за замовчуванням
        category_duration = m.category.match_duration_seconds
        if not category_duration:
            try:
                from apps.rulesets.registry import get_ruleset

                ruleset = get_ruleset(m.category.ruleset_key)
                from apps.rulesets.base import PointsRuleSet

                if isinstance(ruleset, PointsRuleSet):
                    category_duration = ruleset.get_default_duration_seconds()
            except Exception:
                pass

        m.timer_duration_ms = (category_duration * 1000) if category_duration else 180000

        # Очищуємо зафіксовані місця в категорії, бо результати вже не є остаточними
        from apps.tournaments.models import Registration

        Registration.objects.filter(category=m.category).update(place=None)

        m.save()

        event = self._write_event(MatchEvent.EventType.RESET, {}, judge)

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    @transaction.atomic
    def submit_flags_decision(self, flags_aka: int, flags_ao: int, judge=None) -> Match:
        """Застосовує рішення прапорами для рулсетів типу FlagsRuleSet."""
        from apps.rulesets.base import FlagsRuleSet

        m = self.match
        if not isinstance(self.ruleset, FlagsRuleSet):
            raise ValidationError(
                "Рішення прапорами підтримується тільки для FlagsRuleSet рулсетів."
            )

        judges_count = m.judges_count or m.category.judges_count
        if not judges_count:
            raise ValidationError(
                "Не встановлено кількість суддів для цього поєдинку або категорії."
            )

        if flags_aka + flags_ao != judges_count:
            raise ValidationError(
                f"Сума прапорів ({flags_aka} + {flags_ao}) повинна "
                f"дорівнювати кількості суддів ({judges_count})."
            )

        # Застосовуємо логіку рулсету
        state = self._build_state()
        new_state = self.ruleset.apply_flags_decision(state, flags_aka, flags_ao, judges_count)

        m.flags_aka = new_state.flags_aka
        m.flags_ao = new_state.flags_ao
        m.judges_count = new_state.judges_count
        m.save(update_fields=["flags_aka", "flags_ao", "judges_count"])

        winner_reg = m.reg_first if new_state.winner == "aka" else m.reg_second
        if winner_reg is None:
            raise ValidationError(f"Немає учасника в кутку '{new_state.winner}'.")

        m.set_winner(winner_reg, new_state.win_method)

        event = self._write_event(
            MatchEvent.EventType.FLAGS_DECISION,
            {"flags_aka": flags_aka, "flags_ao": flags_ao, "winner": new_state.winner},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    @transaction.atomic
    def toggle_timer(self, show: bool, judge=None) -> Match:
        """Вмикає або вимикає показ таймера на табло."""
        m = self.match
        m.show_timer = show
        m.save(update_fields=["show_timer"])

        event = self._write_event(
            MatchEvent.EventType.TIMER_TOGGLE,
            {"show_timer": show},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    @transaction.atomic
    def set_judges_count(self, judges_count: int, judge=None) -> Match:
        """Встановлює кількість суддів для конкретного поєдинку (3 або 5)."""
        from apps.rulesets.base import FlagsRuleSet

        if not isinstance(self.ruleset, FlagsRuleSet):
            raise ValidationError(
                "Зміна кількості суддів підтримується тільки для рулсетів із прапорцями."
            )

        options = self.ruleset.get_judges_count_options()
        if judges_count not in options:
            raise ValidationError(f"Кількість суддів повинна бути {', '.join(map(str, options))}.")

        m = self.match

        # Якщо поєдинок завершено або встановлено прапори, скидаємо результати цього поєдинку
        if m.flags_aka is not None or m.flags_ao is not None or m.status == Match.Status.COMPLETED:
            can_reset, error_msg = self.can_reset_match()
            if not can_reset:
                raise ValidationError(f"Не можна змінити кількість суддів: {error_msg}")

            # Скидаємо просування переможця в наступний поєдинок, якщо є
            if m.next_match:
                nxt = m.next_match
                nxt_updated = False
                if m.winner == nxt.reg_first:
                    nxt.reg_first = None
                    nxt_updated = True
                elif m.winner == nxt.reg_second:
                    nxt.reg_second = None
                    nxt_updated = True
                if nxt_updated:
                    nxt.save(update_fields=["reg_first", "reg_second"])
                    from apps.common.broadcast import broadcast_match_update

                    broadcast_match_update(nxt)

            m.flags_aka = None
            m.flags_ao = None
            m.winner = None
            m.win_method = ""
            m.status = Match.Status.SCHEDULED
            m.completed_at = None

            # Очищуємо зафіксовані місця в категорії, бо результати вже не є остаточними
            from apps.tournaments.models import Registration

            Registration.objects.filter(category=m.category).update(place=None)

        m.judges_count = judges_count
        m.save(
            update_fields=[
                "judges_count",
                "flags_aka",
                "flags_ao",
                "winner",
                "win_method",
                "status",
                "completed_at",
            ]
        )

        event = self._write_event(
            MatchEvent.EventType.JUDGES_COUNT_CHANGE,
            {"judges_count": judges_count},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m
