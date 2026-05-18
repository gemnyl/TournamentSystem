from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.matches.models import Match, MatchEvent
from apps.rulesets.base import MatchState, ScoreEvent


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
    def apply_score(self, corner: str, action_key: str, judge=None) -> Match:
        """Застосовує ігрову подію (бал або попередження) через активний рулсет."""
        if corner not in ("aka", "ao"):
            raise ValueError(f"Invalid corner: '{corner}'. Must be 'aka' or 'ao'.")

        actions = {a.key: a for a in self.ruleset.get_score_actions()}
        action = actions.get(action_key)
        if action is None:
            raise ValueError(f"Unknown action_key: '{action_key}'.")

        state = self._build_state()
        score_event = ScoreEvent(corner=corner, action_key=action_key)
        new_state = self.ruleset.apply_score_event(state, score_event)
        new_state = self.ruleset.check_auto_finish(new_state)

        m = self.match
        m.score_first = new_state.score_aka
        m.score_second = new_state.score_ao
        m.warnings_first = new_state.warnings_aka
        m.warnings_second = new_state.warnings_ao

        if m.status == Match.Status.SCHEDULED:
            m.status = Match.Status.ONGOING

        update_fields = [
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
            "status",
        ]

        if new_state.is_finished:
            winner_reg = m.reg_first if new_state.winner == "aka" else m.reg_second
            m.winner = winner_reg
            m.win_method = new_state.win_method
            m.status = Match.Status.COMPLETED
            m.completed_at = timezone.now()
            update_fields += ["winner", "win_method", "completed_at"]
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
