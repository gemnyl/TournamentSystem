from collections.abc import Sequence
from dataclasses import replace
from typing import cast

from apps.rulesets.base import FlagsRuleSet, MatchState, WinMethodSpec
from apps.rulesets.registry import register_ruleset


class KarateKataRuleSet(FlagsRuleSet):
    key = "karate_kata"
    name = "Karate Kata"
    sport_type = "karate"

    def get_judges_count_options(self) -> Sequence[int]:
        return [3, 5]

    def get_win_methods(self) -> Sequence[WinMethodSpec]:
        return [
            WinMethodSpec(key="decision", label="За рішенням суддів"),
            WinMethodSpec(key="walkover", label="Неявка суперника"),
        ]

    def apply_flags_decision(
        self, state: MatchState, flags_aka: int, flags_ao: int, judges_count: int
    ) -> MatchState:
        if flags_aka + flags_ao != judges_count:
            raise ValueError(
                f"Сума прапорів ({flags_aka} + {flags_ao}) повинна "
                f"дорівнювати кількості суддів ({judges_count})"
            )

        # Переможець за більшістю прапорів
        winner = "aka" if flags_aka > flags_ao else "ao"

        new_state = replace(
            state,
            flags_aka=flags_aka,
            flags_ao=flags_ao,
            judges_count=judges_count,
            winner=winner,
            win_method="decision",
            is_finished=True,
        )
        return cast(MatchState, new_state)


register_ruleset(KarateKataRuleSet)
