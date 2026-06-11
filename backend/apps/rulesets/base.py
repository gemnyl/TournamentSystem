from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import cast


class JudgingMode(StrEnum):
    POINTS = "points"
    FLAGS = "flags"


@dataclass(frozen=True)
class ScoreAction:
    key: str
    label: str
    points: int
    is_warning: bool = False


@dataclass(frozen=True)
class WinMethodSpec:
    key: str
    label: str
    requires_score_diff: bool = False


@dataclass(frozen=True)
class MatchState:
    score_aka: int = 0
    score_ao: int = 0
    warnings_aka: int = 0
    warnings_ao: int = 0
    flags_aka: int | None = None
    flags_ao: int | None = None
    judges_count: int | None = None
    senshu: str = "none"  # 'none' | 'aka' | 'ao'
    winner: str | None = None
    win_method: str | None = None
    is_finished: bool = False


@dataclass(frozen=True)
class ScoreEvent:
    corner: str  # 'aka' | 'ao'
    action_key: str


class BaseRuleSet(ABC):
    key: str
    name: str
    sport_type: str
    judging_mode: JudgingMode

    @abstractmethod
    def get_win_methods(self) -> Sequence[WinMethodSpec]: ...


class PointsRuleSet(BaseRuleSet):
    judging_mode = JudgingMode.POINTS

    @abstractmethod
    def get_score_actions(self) -> Sequence[ScoreAction]: ...

    def apply_score_event(self, state: MatchState, event: ScoreEvent) -> MatchState:
        actions = {a.key: a for a in self.get_score_actions()}
        action = actions.get(event.action_key)
        if action is None:
            raise ValueError(f"Unknown action_key: '{event.action_key}'")

        if action.is_warning:
            if event.corner == "aka":
                return cast(MatchState, replace(state, warnings_aka=state.warnings_aka + 1))
            return cast(MatchState, replace(state, warnings_ao=state.warnings_ao + 1))

        if event.corner == "aka":
            return cast(MatchState, replace(state, score_aka=state.score_aka + action.points))
        return cast(MatchState, replace(state, score_ao=state.score_ao + action.points))

    @abstractmethod
    def get_default_duration_seconds(self) -> int: ...

    @abstractmethod
    def get_max_warnings(self) -> int: ...

    def check_warnings_finish(self, state: MatchState) -> MatchState | None:
        if state.warnings_aka >= self.get_max_warnings():
            new = replace(state, is_finished=True, winner="ao", win_method="hansoku")
            return cast(MatchState, new)
        if state.warnings_ao >= self.get_max_warnings():
            new = replace(state, is_finished=True, winner="aka", win_method="hansoku")
            return cast(MatchState, new)
        return None

    @abstractmethod
    def check_auto_finish(self, state: MatchState) -> MatchState: ...


class FlagsRuleSet(BaseRuleSet):
    """Stub для Kata-фази — не реалізовано в поточній фазі."""

    judging_mode = JudgingMode.FLAGS

    @abstractmethod
    def get_judges_count_options(self) -> Sequence[int]: ...

    @abstractmethod
    def apply_flags_decision(
        self, state: MatchState, flags_aka: int, flags_ao: int, judges_count: int
    ) -> MatchState: ...
