from collections.abc import Sequence
from dataclasses import replace

from apps.rulesets.base import MatchState, PointsRuleSet, ScoreAction, ScoreEvent, WinMethodSpec
from apps.rulesets.registry import register_ruleset


class KarateWKFRuleSet(PointsRuleSet):
    key = "karate_wkf"
    name = "Karate WKF Kumite"
    sport_type = "karate"

    def get_score_actions(self) -> Sequence[ScoreAction]:
        return [
            ScoreAction(key="yuko", label="Yuko", points=1),
            ScoreAction(key="wazaari", label="Waza-ari", points=2),
            ScoreAction(key="ippon", label="Ippon", points=3),
            ScoreAction(key="penalty", label="Penalty", points=0, is_warning=True),
        ]

    def get_win_methods(self) -> Sequence[WinMethodSpec]:
        return [
            WinMethodSpec(key="points", label="За очками", requires_score_diff=True),
            WinMethodSpec(key="hantei", label="Hantei (рішення суддів)"),
            WinMethodSpec(key="hansoku", label="Hansoku (дискваліфікація)"),
            WinMethodSpec(key="kiken", label="Kiken (відмова від участі)"),
        ]

    def get_default_duration_seconds(self) -> int:
        return 180

    def get_max_warnings(self) -> int:
        return 5

    def apply_score_event(self, state: MatchState, event: ScoreEvent) -> MatchState:
        actions = {a.key: a for a in self.get_score_actions()}
        action = actions.get(event.action_key)
        if action is None:
            raise ValueError(f"Unknown action_key: '{event.action_key}'")

        if action.is_warning:
            if event.corner == "aka":
                return replace(state, warnings_aka=state.warnings_aka + 1)
            return replace(state, warnings_ao=state.warnings_ao + 1)

        if event.corner == "aka":
            return replace(state, score_aka=state.score_aka + action.points)
        return replace(state, score_ao=state.score_ao + action.points)

    def check_auto_finish(self, state: MatchState) -> MatchState:
        diff = abs(state.score_aka - state.score_ao)
        if diff >= 8:
            winner = "aka" if state.score_aka > state.score_ao else "ao"
            return replace(state, is_finished=True, winner=winner, win_method="points")

        if state.warnings_aka >= self.get_max_warnings():
            return replace(state, is_finished=True, winner="ao", win_method="hansoku")
        if state.warnings_ao >= self.get_max_warnings():
            return replace(state, is_finished=True, winner="aka", win_method="hansoku")

        return state


register_ruleset(KarateWKFRuleSet)
