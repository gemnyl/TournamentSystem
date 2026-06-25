from collections.abc import Sequence

from apps.rulesets.base import BaseRuleSet, JudgingMode, WinMethodSpec
from apps.rulesets.registry import register_ruleset


class TaekwondoWTRuleSet(BaseRuleSet):
    key = "taekwondo_wt"
    name = "Taekwondo WT"
    sport_type = "taekwondo"
    judging_mode = JudgingMode.POINTS

    def get_win_methods(self) -> Sequence[WinMethodSpec]:
        return [
            WinMethodSpec(key="points", label="За очками"),
            WinMethodSpec(key="ptg", label="Point Gap (дострокова перевага)"),
            WinMethodSpec(key="pun", label="Gam-jeom (10 порушень)"),
            WinMethodSpec(key="withdrawal", label="Зняття з поєдинку"),
        ]

    def get_default_state(self) -> dict:
        return {
            "current_round": 1,
            "rounds_won": {"chung": 0, "hong": 0},
            "scores": {"chung": 0, "hong": 0},
            "gam_jeoms": {"chung": 0, "hong": 0},
            "round_history": [],
        }

    def _transition_round(
        self, state: dict, round_winner: str | None, method: str
    ) -> tuple[bool, str | None, str | None]:
        s_chung = state["scores"]["chung"]
        s_hong = state["scores"]["hong"]
        curr_round = state["current_round"]

        if round_winner in ("chung", "hong"):
            state["rounds_won"][round_winner] = state["rounds_won"].get(round_winner, 0) + 1

        state["round_history"].append(
            {
                "round": curr_round,
                "scores": {"chung": s_chung, "hong": s_hong},
                "gam_jeoms": {
                    "chung": state["gam_jeoms"]["chung"],
                    "hong": state["gam_jeoms"]["hong"],
                },
                "winner": round_winner,
                "win_method": method,
            }
        )

        is_finished = False
        winner = None
        win_method = None

        total_gam_chung = sum(h["gam_jeoms"]["chung"] for h in state["round_history"])
        total_gam_hong = sum(h["gam_jeoms"]["hong"] for h in state["round_history"])

        if total_gam_chung >= 10:
            is_finished = True
            winner = "hong"
            win_method = "pun"
        elif total_gam_hong >= 10:
            is_finished = True
            winner = "chung"
            win_method = "pun"
        elif method == "ptg" and curr_round in (2, 3):
            is_finished = True
            winner = round_winner
            win_method = "ptg"
        elif state["rounds_won"]["chung"] == 2:
            is_finished = True
            winner = "chung"
            win_method = "points"
        elif state["rounds_won"]["hong"] == 2:
            is_finished = True
            winner = "hong"
            win_method = "points"

        if not is_finished:
            state["scores"] = {"chung": 0, "hong": 0}
            state["gam_jeoms"] = {"chung": 0, "hong": 0}
            state["current_round"] += 1

        return is_finished, winner, win_method

    def _apply_ruleset_event_impl(
        self, state: dict, event_type: str, payload: dict
    ) -> tuple[bool, str | None, str | None]:
        is_finished = False
        winner = None
        win_method = None

        if event_type == "ADD_POINTS":
            corner = payload.get("corner")
            points = int(payload.get("points", 0))
            if corner in ("chung", "hong"):
                state["scores"][corner] = state["scores"].get(corner, 0) + points

        elif event_type == "SUB_POINTS":
            corner = payload.get("corner")
            points = int(payload.get("points", 0))
            if corner in ("chung", "hong"):
                state["scores"][corner] = max(0, state["scores"].get(corner, 0) - points)

        elif event_type == "ADD_GAM_JEOM":
            corner = payload.get("corner")
            is_passive = payload.get("is_passive", False)
            remaining_seconds = payload.get("remaining_seconds", 999)
            if corner in ("chung", "hong"):
                state["gam_jeoms"][corner] = state["gam_jeoms"].get(corner, 0) + 1
                opponent = "hong" if corner == "chung" else "chung"

                # Double penalty rule (June 2026):
                # Last 10 seconds passive actions give +2 points to opponent
                points_to_add = 2 if (is_passive and remaining_seconds <= 10) else 1
                state["scores"][opponent] = state["scores"].get(opponent, 0) + points_to_add

        elif event_type == "SUB_GAM_JEOM":
            corner = payload.get("corner")
            is_passive = payload.get("is_passive", False)
            remaining_seconds = payload.get("remaining_seconds", 999)
            if corner in ("chung", "hong"):
                state["gam_jeoms"][corner] = max(0, state["gam_jeoms"].get(corner, 0) - 1)
                opponent = "hong" if corner == "chung" else "chung"

                points_to_sub = 2 if (is_passive and remaining_seconds <= 10) else 1
                state["scores"][opponent] = max(0, state["scores"].get(opponent, 0) - points_to_sub)

        elif event_type == "NEXT_ROUND":
            s_chung = state["scores"]["chung"]
            s_hong = state["scores"]["hong"]
            round_winner = payload.get("round_winner")
            if not round_winner:
                if s_chung > s_hong:
                    round_winner = "chung"
                elif s_hong > s_chung:
                    round_winner = "hong"

            method = "ptg" if abs(s_chung - s_hong) >= 15 else "points"
            is_finished, winner, win_method = self._transition_round(state, round_winner, method)

        elif event_type == "RESET_ROUND":
            state["scores"] = {"chung": 0, "hong": 0}
            state["gam_jeoms"] = {"chung": 0, "hong": 0}

        elif event_type == "UNDO_ROUND":
            if state.get("round_history"):
                last_round = state["round_history"].pop()
                state["current_round"] = max(1, state["current_round"] - 1)
                state["rounds_won"] = {"chung": 0, "hong": 0}
                for h in state["round_history"]:
                    w = h.get("winner")
                    if w in ("chung", "hong"):
                        state["rounds_won"][w] += 1
                state["scores"] = last_round.get("scores", {"chung": 0, "hong": 0})
                state["gam_jeoms"] = last_round.get("gam_jeoms", {"chung": 0, "hong": 0})

        # Check instant match win/loss due to 10 Gam-jeoms (cumulative)
        total_gam_chung = sum(
            h["gam_jeoms"]["chung"] for h in state.get("round_history", [])
        ) + state["gam_jeoms"].get("chung", 0)
        total_gam_hong = sum(
            h["gam_jeoms"]["hong"] for h in state.get("round_history", [])
        ) + state["gam_jeoms"].get("hong", 0)

        if not is_finished:
            if total_gam_chung >= 10:
                is_finished = True
                winner = "hong"
                win_method = "pun"
            elif total_gam_hong >= 10:
                is_finished = True
                winner = "chung"
                win_method = "pun"

        # Check round-level auto-resolution (Point Gap >= 12 or Gam-jeoms in a round >= 5)
        if not is_finished:
            s_chung = state["scores"]["chung"]
            s_hong = state["scores"]["hong"]
            if abs(s_chung - s_hong) >= 15:
                round_winner = "chung" if s_chung > s_hong else "hong"
                is_finished, winner, win_method = self._transition_round(state, round_winner, "ptg")

        if not is_finished:
            g_chung = state["gam_jeoms"]["chung"]
            g_hong = state["gam_jeoms"]["hong"]
            if g_chung >= 5:
                is_finished, winner, win_method = self._transition_round(state, "hong", "gam_jeom")
            elif g_hong >= 5:
                is_finished, winner, win_method = self._transition_round(state, "chung", "gam_jeom")

        # Check rounds_won match win
        if not is_finished:
            if state["rounds_won"]["chung"] == 2:
                is_finished = True
                winner = "chung"
                win_method = "points"
            elif state["rounds_won"]["hong"] == 2:
                is_finished = True
                winner = "hong"
                win_method = "points"

        return is_finished, winner, win_method


register_ruleset(TaekwondoWTRuleSet)
