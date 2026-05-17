from collections.abc import Sequence
from dataclasses import replace

from apps.rulesets.base import MatchState, PointsRuleSet, ScoreAction, ScoreEvent, WinMethodSpec
from apps.rulesets.registry import register_ruleset


class ShobuIpponRuleSet(PointsRuleSet):
    key = "shobu_ippon"
    name = "Shobu Ippon"
    sport_type = "karate"

    def get_score_actions(self) -> Sequence[ScoreAction]:
        return [
            ScoreAction(key="wazaari", label="Waza-ari", points=1),
            ScoreAction(key="ippon", label="Ippon", points=2),
            ScoreAction(key="penalty", label="Penalty", points=0, is_warning=True),
        ]

    def get_win_methods(self) -> Sequence[WinMethodSpec]:
        return [
            WinMethodSpec(key="ippon", label="Ippon"),
            WinMethodSpec(key="wazaari", label="Waza-ari (×2)"),
            WinMethodSpec(key="hansoku", label="Hansoku (дискваліфікація)"),
            WinMethodSpec(key="hantei", label="Hantei (рішення суддів)"),
        ]

    def get_default_duration_seconds(self) -> int:
        return 120

    def get_max_warnings(self) -> int:
        return 3

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
        if state.score_aka >= 2:
            return replace(state, is_finished=True, winner="aka", win_method="ippon")
        if state.score_ao >= 2:
            return replace(state, is_finished=True, winner="ao", win_method="ippon")

        if state.warnings_aka >= self.get_max_warnings():
            return replace(state, is_finished=True, winner="ao", win_method="hansoku")
        if state.warnings_ao >= self.get_max_warnings():
            return replace(state, is_finished=True, winner="aka", win_method="hansoku")

        return state


register_ruleset(ShobuIpponRuleSet)
