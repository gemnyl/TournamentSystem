from collections.abc import Sequence
from dataclasses import replace
from typing import cast

from apps.rulesets.base import MatchState, PointsRuleSet, ScoreAction, WinMethodSpec
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

    def check_auto_finish(self, state: MatchState) -> MatchState:
        diff = abs(state.score_aka - state.score_ao)
        if diff >= 8:
            winner = "aka" if state.score_aka > state.score_ao else "ao"
            new = replace(state, is_finished=True, winner=winner, win_method="points")
            return cast(MatchState, new)

        warnings_state = self.check_warnings_finish(state)
        if warnings_state is not None:
            return warnings_state

        return state


register_ruleset(KarateWKFRuleSet)
