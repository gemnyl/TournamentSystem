from collections.abc import Sequence
from dataclasses import replace
from typing import cast

from apps.rulesets.base import MatchState, PointsRuleSet, ScoreAction, WinMethodSpec
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

    def check_auto_finish(self, state: MatchState) -> MatchState:
        if state.score_aka >= 2:
            new = replace(state, is_finished=True, winner="aka", win_method="ippon")
            return cast(MatchState, new)
        if state.score_ao >= 2:
            new = replace(state, is_finished=True, winner="ao", win_method="ippon")
            return cast(MatchState, new)

        if state.warnings_aka >= self.get_max_warnings():
            new = replace(state, is_finished=True, winner="ao", win_method="hansoku")
            return cast(MatchState, new)
        if state.warnings_ao >= self.get_max_warnings():
            new = replace(state, is_finished=True, winner="aka", win_method="hansoku")
            return cast(MatchState, new)

        return state


register_ruleset(ShobuIpponRuleSet)
