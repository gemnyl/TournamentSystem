from collections.abc import Sequence

from apps.rulesets.base import BaseRuleSet, JudgingMode, WinMethodSpec
from apps.rulesets.registry import register_ruleset


class JudoIJFRuleSet(BaseRuleSet):
    key = "judo_ijf"
    name = "Judo IJF"
    sport_type = "judo"
    judging_mode = JudgingMode.POINTS

    def get_win_methods(self) -> Sequence[WinMethodSpec]:
        return [
            WinMethodSpec(key="ippon", label="Ippon"),
            WinMethodSpec(key="wazaari", label="Waza-ari"),
            WinMethodSpec(key="hansoku", label="Hansoku-make (дискваліфікація)"),
            WinMethodSpec(key="withdrawal", label="Зняття з поєдинку"),
        ]

    def get_default_state(self) -> dict:
        return {
            "scores": {"shiro": {"waza_ari": 0, "ippon": 0}, "ao": {"waza_ari": 0, "ippon": 0}},
            "penalties": {
                "shiro": {"shido": 0, "hansoku_make": False},
                "ao": {"shido": 0, "hansoku_make": False},
            },
            "is_golden_score": False,
            "osaekomi": {"active_for": None, "start_timestamp": None},
        }

    def _apply_ruleset_event_impl(
        self, state: dict, event_type: str, payload: dict
    ) -> tuple[bool, str | None, str | None]:
        is_finished = False
        winner = None
        win_method = None

        # Keep track of old scores to detect score changes in Golden Score
        old_shiro_waza = state["scores"]["shiro"]["waza_ari"]
        old_shiro_ippon = state["scores"]["shiro"]["ippon"]
        old_ao_waza = state["scores"]["ao"]["waza_ari"]
        old_ao_ippon = state["scores"]["ao"]["ippon"]

        if event_type == "ADD_WAZA_ARI":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["scores"][corner]["waza_ari"] += 1
                if state["scores"][corner]["waza_ari"] >= 2:
                    state["scores"][corner]["waza_ari"] = 0
                    state["scores"][corner]["ippon"] = 1

        elif event_type == "ADD_IPPON":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["scores"][corner]["ippon"] = 1

        elif event_type == "ADD_SHIDO":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["penalties"][corner]["shido"] += 1
                if state["penalties"][corner]["shido"] >= 3:
                    state["penalties"][corner]["hansoku_make"] = True

        elif event_type == "ADD_HANSOKU_MAKE":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["penalties"][corner]["hansoku_make"] = True

        elif event_type == "SUB_WAZA_ARI":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["scores"][corner]["waza_ari"] = max(
                    0, state["scores"][corner]["waza_ari"] - 1
                )

        elif event_type == "SUB_IPPON":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["scores"][corner]["ippon"] = 0

        elif event_type == "SUB_SHIDO":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["penalties"][corner]["shido"] = max(
                    0, state["penalties"][corner]["shido"] - 1
                )
                if state["penalties"][corner]["shido"] < 3:
                    state["penalties"][corner]["hansoku_make"] = False

        elif event_type == "SUB_HANSOKU_MAKE":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["penalties"][corner]["hansoku_make"] = False

        elif event_type == "TOGGLE_GOLDEN_SCORE":
            state["is_golden_score"] = not state["is_golden_score"]

        elif event_type == "START_OSAEKOMI":
            corner = payload.get("corner")
            if corner in ("shiro", "ao"):
                state["osaekomi"]["active_for"] = corner
                state["osaekomi"]["start_timestamp"] = payload.get("start_timestamp")

        elif event_type == "STOP_OSAEKOMI":
            state["osaekomi"]["active_for"] = None
            state["osaekomi"]["start_timestamp"] = None

        # Check Golden Score win condition (any new score ends the match)
        if state["is_golden_score"]:
            shiro_scored = (
                state["scores"]["shiro"]["waza_ari"] > old_shiro_waza
                or state["scores"]["shiro"]["ippon"] > old_shiro_ippon
            )
            ao_scored = (
                state["scores"]["ao"]["waza_ari"] > old_ao_waza
                or state["scores"]["ao"]["ippon"] > old_ao_ippon
            )
            if shiro_scored:
                is_finished = True
                winner = "shiro"
                win_method = (
                    "wazaari" if state["scores"]["shiro"]["waza_ari"] > old_shiro_waza else "ippon"
                )
            elif ao_scored:
                is_finished = True
                winner = "ao"
                win_method = (
                    "wazaari" if state["scores"]["ao"]["waza_ari"] > old_ao_waza else "ippon"
                )

        # Check Hansoku-make condition (3 shidos or direct hansoku-make)
        if not is_finished:
            if state["penalties"]["shiro"]["hansoku_make"]:
                is_finished = True
                winner = "ao"
                win_method = "hansoku"
            elif state["penalties"]["ao"]["hansoku_make"]:
                is_finished = True
                winner = "shiro"
                win_method = "hansoku"

        # Check Ippon condition
        if not is_finished:
            if state["scores"]["shiro"]["ippon"] >= 1:
                is_finished = True
                winner = "shiro"
                win_method = "ippon"
            elif state["scores"]["ao"]["ippon"] >= 1:
                is_finished = True
                winner = "ao"
                win_method = "ippon"

        return is_finished, winner, win_method


register_ruleset(JudoIJFRuleSet)
