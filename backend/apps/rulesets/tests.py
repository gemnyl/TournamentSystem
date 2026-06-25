from django.test import TestCase

from apps.rulesets.base import MatchState, ScoreEvent
from apps.rulesets.karate_wkf import KarateWKFRuleSet
from apps.rulesets.registry import get_ruleset, list_rulesets
from apps.rulesets.shobu_ippon import ShobuIpponRuleSet


class KarateWKFRuleSetTest(TestCase):
    def setUp(self):
        self.ruleset = KarateWKFRuleSet()

    def test_score_actions_defined(self):
        keys = {a.key for a in self.ruleset.get_score_actions()}
        self.assertIn("yuko", keys)
        self.assertIn("wazaari", keys)
        self.assertIn("ippon", keys)
        self.assertIn("penalty", keys)

    def test_apply_yuko_aka(self):
        state = MatchState()
        result = self.ruleset.apply_score_event(state, ScoreEvent(corner="aka", action_key="yuko"))
        self.assertEqual(result.score_aka, 1)
        self.assertEqual(result.score_ao, 0)

    def test_apply_ippon_ao(self):
        state = MatchState()
        result = self.ruleset.apply_score_event(state, ScoreEvent(corner="ao", action_key="ippon"))
        self.assertEqual(result.score_ao, 3)

    def test_apply_penalty_adds_warning(self):
        state = MatchState()
        result = self.ruleset.apply_score_event(
            state, ScoreEvent(corner="aka", action_key="penalty")
        )
        self.assertEqual(result.warnings_aka, 1)
        self.assertEqual(result.score_aka, 0)

    def test_auto_finish_8_point_diff(self):
        state = MatchState(score_aka=8, score_ao=0)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "aka")
        self.assertEqual(result.win_method, "points")

    def test_auto_finish_no_trigger_below_8(self):
        state = MatchState(score_aka=7, score_ao=0)
        result = self.ruleset.check_auto_finish(state)
        self.assertFalse(result.is_finished)

    def test_auto_finish_hansoku_at_5_warnings(self):
        state = MatchState(warnings_aka=5)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "ao")
        self.assertEqual(result.win_method, "hansoku")

    def test_no_auto_finish_at_4_warnings(self):
        state = MatchState(warnings_aka=4)
        result = self.ruleset.check_auto_finish(state)
        self.assertFalse(result.is_finished)

    def test_duration_180(self):
        self.assertEqual(self.ruleset.get_default_duration_seconds(), 180)

    def test_max_warnings_5(self):
        self.assertEqual(self.ruleset.get_max_warnings(), 5)

    def test_apply_penalty_ao(self):
        state = MatchState()
        event = ScoreEvent(corner="ao", action_key="penalty")
        result = self.ruleset.apply_score_event(state, event)
        self.assertEqual(result.warnings_ao, 1)
        self.assertEqual(result.score_ao, 0)

    def test_auto_finish_hansoku_ao_at_5_warnings(self):
        state = MatchState(warnings_ao=5)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "aka")
        self.assertEqual(result.win_method, "hansoku")

    def test_get_win_methods_defined(self):
        methods = {m.key for m in self.ruleset.get_win_methods()}
        self.assertIn("points", methods)
        self.assertIn("hantei", methods)
        self.assertIn("hansoku", methods)
        self.assertIn("kiken", methods)

    def test_invalid_action_raises(self):
        with self.assertRaises(ValueError):
            self.ruleset.apply_score_event(MatchState(), ScoreEvent(corner="aka", action_key="???"))


class ShobuIpponRuleSetTest(TestCase):
    def setUp(self):
        self.ruleset = ShobuIpponRuleSet()

    def test_score_actions_defined(self):
        keys = {a.key for a in self.ruleset.get_score_actions()}
        self.assertIn("wazaari", keys)
        self.assertIn("ippon", keys)
        self.assertIn("penalty", keys)
        self.assertNotIn("yuko", keys)

    def test_ippon_gives_2_points(self):
        state = MatchState()
        result = self.ruleset.apply_score_event(state, ScoreEvent(corner="aka", action_key="ippon"))
        self.assertEqual(result.score_aka, 2)

    def test_auto_finish_on_2_points(self):
        state = MatchState(score_ao=2)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "ao")

    def test_no_auto_finish_at_1_point(self):
        state = MatchState(score_aka=1)
        result = self.ruleset.check_auto_finish(state)
        self.assertFalse(result.is_finished)

    def test_auto_finish_hansoku_at_3_warnings(self):
        state = MatchState(warnings_ao=3)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "aka")
        self.assertEqual(result.win_method, "hansoku")

    def test_no_auto_finish_at_2_warnings(self):
        state = MatchState(warnings_aka=2)
        result = self.ruleset.check_auto_finish(state)
        self.assertFalse(result.is_finished)

    def test_duration_120(self):
        self.assertEqual(self.ruleset.get_default_duration_seconds(), 120)

    def test_max_warnings_3(self):
        self.assertEqual(self.ruleset.get_max_warnings(), 3)

    def test_2_wazaari_wins(self):
        state = MatchState(score_aka=0)
        state = self.ruleset.apply_score_event(
            state, ScoreEvent(corner="aka", action_key="wazaari")
        )
        state = self.ruleset.apply_score_event(
            state, ScoreEvent(corner="aka", action_key="wazaari")
        )
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "aka")

    def test_auto_finish_hansoku_aka_at_3_warnings(self):
        state = MatchState(warnings_aka=3)
        result = self.ruleset.check_auto_finish(state)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "ao")
        self.assertEqual(result.win_method, "hansoku")

    def test_get_win_methods_defined(self):
        methods = {m.key for m in self.ruleset.get_win_methods()}
        self.assertIn("ippon", methods)
        self.assertIn("wazaari", methods)
        self.assertIn("hansoku", methods)
        self.assertIn("hantei", methods)


class RegistryTest(TestCase):
    def test_list_rulesets_returns_all(self):
        rulesets = list_rulesets()
        keys = {r["key"] for r in rulesets}
        self.assertIn("karate_wkf", keys)
        self.assertIn("shobu_ippon", keys)
        self.assertIn("karate_kata", keys)

    def test_list_rulesets_has_required_fields(self):
        for rs in list_rulesets():
            for field in ("key", "name", "sport_type", "judging_mode"):
                self.assertIn(field, rs)

    def test_get_ruleset_returns_instance(self):
        rs = get_ruleset("karate_wkf")
        self.assertEqual(rs.key, "karate_wkf")
        rs_kata = get_ruleset("karate_kata")
        self.assertEqual(rs_kata.key, "karate_kata")

    def test_get_ruleset_unknown_key_raises(self):
        with self.assertRaises(KeyError):
            get_ruleset("nonexistent_ruleset")


class KarateKataRuleSetTest(TestCase):
    def setUp(self):
        from apps.rulesets.karate_kata import KarateKataRuleSet

        self.ruleset = KarateKataRuleSet()

    def test_judges_count_options(self):
        self.assertEqual(list(self.ruleset.get_judges_count_options()), [3, 5])

    def test_win_methods(self):
        methods = {m.key for m in self.ruleset.get_win_methods()}
        self.assertIn("decision", methods)
        self.assertIn("walkover", methods)

    def test_apply_flags_decision_aka_wins(self):
        state = MatchState()
        result = self.ruleset.apply_flags_decision(state, flags_aka=3, flags_ao=2, judges_count=5)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "aka")
        self.assertEqual(result.win_method, "decision")
        self.assertEqual(result.flags_aka, 3)
        self.assertEqual(result.flags_ao, 2)
        self.assertEqual(result.judges_count, 5)

    def test_apply_flags_decision_ao_wins(self):
        state = MatchState()
        result = self.ruleset.apply_flags_decision(state, flags_aka=1, flags_ao=2, judges_count=3)
        self.assertTrue(result.is_finished)
        self.assertEqual(result.winner, "ao")
        self.assertEqual(result.win_method, "decision")

    def test_apply_flags_decision_invalid_sum_raises(self):
        state = MatchState()
        with self.assertRaises(ValueError):
            self.ruleset.apply_flags_decision(state, flags_aka=2, flags_ao=2, judges_count=5)


class TaekwondoWTRuleSetTest(TestCase):
    def setUp(self):
        from apps.rulesets.taekwondo_wt import TaekwondoWTRuleSet

        self.ruleset = TaekwondoWTRuleSet()

    def test_default_state(self):
        state = self.ruleset.get_default_state()
        self.assertEqual(state["current_round"], 1)
        self.assertEqual(state["scores"]["chung"], 0)
        self.assertEqual(state["rounds_won"]["chung"], 0)

    def test_add_sub_points(self):
        state = self.ruleset.get_default_state()
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_POINTS", {"corner": "chung", "points": 3}
        )
        self.assertEqual(state["scores"]["chung"], 3)
        self.assertFalse(is_finished)

        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "SUB_POINTS", {"corner": "chung", "points": 1}
        )
        self.assertEqual(state["scores"]["chung"], 2)

    def test_add_gam_jeom(self):
        state = self.ruleset.get_default_state()
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_GAM_JEOM", {"corner": "chung"}
        )
        self.assertEqual(state["gam_jeoms"]["chung"], 1)
        self.assertEqual(state["scores"]["hong"], 1)

    def test_next_round_winner(self):
        state = self.ruleset.get_default_state()
        state["scores"]["chung"] = 5
        state["scores"]["hong"] = 2
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "NEXT_ROUND", {}
        )
        self.assertEqual(state["rounds_won"]["chung"], 1)
        self.assertEqual(state["scores"]["chung"], 0)
        self.assertEqual(state["current_round"], 2)

    def test_win_by_rounds(self):
        state = self.ruleset.get_default_state()
        state["rounds_won"]["chung"] = 1
        state["scores"]["chung"] = 5
        state["scores"]["hong"] = 2
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "NEXT_ROUND", {}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "chung")
        self.assertEqual(method, "points")

    def test_win_by_gam_jeoms(self):
        state = self.ruleset.get_default_state()
        state["gam_jeoms"]["chung"] = 9
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_GAM_JEOM", {"corner": "chung"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "hong")
        self.assertEqual(method, "pun")

    def test_win_by_point_gap_round2(self):
        state = self.ruleset.get_default_state()
        state["current_round"] = 2
        state["scores"]["chung"] = 16
        state["scores"]["hong"] = 1
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "NEXT_ROUND", {}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "chung")
        self.assertEqual(method, "ptg")

    def test_auto_round_win_by_point_gap(self):
        state = self.ruleset.get_default_state()
        # Add 15 points to chung to trigger point gap (15-0)
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_POINTS", {"corner": "chung", "points": 15}
        )
        # Since it is round 1, triggering point gap should transition to round 2, not end the match
        self.assertFalse(is_finished)
        self.assertEqual(state["current_round"], 2)
        self.assertEqual(state["rounds_won"]["chung"], 1)
        self.assertEqual(len(state["round_history"]), 1)
        self.assertEqual(state["round_history"][0]["winner"], "chung")
        self.assertEqual(state["round_history"][0]["win_method"], "ptg")

    def test_auto_round_win_by_five_gam_jeoms(self):
        state = self.ruleset.get_default_state()
        # Add 5 Gam-jeoms to chung. Each Gam-jeom gives opponent (hong) 1 point.
        for _ in range(5):
            state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
                state, "ADD_GAM_JEOM", {"corner": "chung"}
            )
        # 5 Gam-jeoms in a round should transition the round, awarding round win to hong
        self.assertFalse(is_finished)
        self.assertEqual(state["current_round"], 2)
        self.assertEqual(state["rounds_won"]["hong"], 1)
        self.assertEqual(state["round_history"][0]["winner"], "hong")
        self.assertEqual(state["round_history"][0]["win_method"], "gam_jeom")

    def test_match_win_by_cumulative_ten_gam_jeoms(self):
        state = self.ruleset.get_default_state()
        # Add 4 Gam-jeoms to chung in round 1, then transition round manually
        for _ in range(4):
            state, _, _, _ = self.ruleset.apply_ruleset_event(
                state, "ADD_GAM_JEOM", {"corner": "chung"}
            )
        state, _, _, _ = self.ruleset.apply_ruleset_event(
            state, "NEXT_ROUND", {"round_winner": "hong"}
        )

        # Add 5 Gam-jeoms to chung in round 2 (total 9)
        for _ in range(5):
            # The 5th Gam-jeom will transition round 2 to round 3
            state, _, _, _ = self.ruleset.apply_ruleset_event(
                state, "ADD_GAM_JEOM", {"corner": "chung"}
            )

        # Add 1 Gam-jeom in round 3 (reaches 10)
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_GAM_JEOM", {"corner": "chung"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "hong")
        self.assertEqual(method, "pun")

    def test_double_gam_jeom_in_last_10_seconds(self):
        state = self.ruleset.get_default_state()

        # 1. Normal Gam-jeom (more than 10 seconds remaining, or not passive)
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_GAM_JEOM", {"corner": "chung", "is_passive": True, "remaining_seconds": 15}
        )
        self.assertEqual(state["gam_jeoms"]["chung"], 1)
        self.assertEqual(state["scores"]["hong"], 1)

        # 2. Passive Gam-jeom inside last 10 seconds
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_GAM_JEOM", {"corner": "chung", "is_passive": True, "remaining_seconds": 8}
        )
        self.assertEqual(state["gam_jeoms"]["chung"], 2)
        self.assertEqual(state["scores"]["hong"], 3)  # Opponent gets +2 points (1 + 2 = 3)

        # 3. Undo passive Gam-jeom inside last 10 seconds
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "SUB_GAM_JEOM", {"corner": "chung", "is_passive": True, "remaining_seconds": 8}
        )
        self.assertEqual(state["gam_jeoms"]["chung"], 1)
        self.assertEqual(state["scores"]["hong"], 1)  # Opponent loses -2 points (3 - 2 = 1)


class JudoIJFRuleSetTest(TestCase):
    def setUp(self):
        from apps.rulesets.judo_ijf import JudoIJFRuleSet

        self.ruleset = JudoIJFRuleSet()

    def test_default_state(self):
        state = self.ruleset.get_default_state()
        self.assertEqual(state["scores"]["shiro"]["waza_ari"], 0)
        self.assertEqual(state["penalties"]["shiro"]["shido"], 0)
        self.assertFalse(state["is_golden_score"])

    def test_add_waza_ari_and_ippon(self):
        state = self.ruleset.get_default_state()
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_WAZA_ARI", {"corner": "shiro"}
        )
        self.assertEqual(state["scores"]["shiro"]["waza_ari"], 1)
        self.assertFalse(is_finished)

        # 2nd Waza-ari turns to Ippon
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_WAZA_ARI", {"corner": "shiro"}
        )
        self.assertEqual(state["scores"]["shiro"]["waza_ari"], 0)
        self.assertEqual(state["scores"]["shiro"]["ippon"], 1)
        self.assertTrue(is_finished)
        self.assertEqual(winner, "shiro")
        self.assertEqual(method, "ippon")

    def test_add_shido(self):
        state = self.ruleset.get_default_state()
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_SHIDO", {"corner": "shiro"}
        )
        self.assertEqual(state["penalties"]["shiro"]["shido"], 1)
        self.assertFalse(is_finished)

        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_SHIDO", {"corner": "shiro"}
        )
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_SHIDO", {"corner": "shiro"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "ao")
        self.assertEqual(method, "hansoku")

    def test_golden_score_win(self):
        state = self.ruleset.get_default_state()
        state["is_golden_score"] = True
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_WAZA_ARI", {"corner": "ao"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "ao")
        self.assertEqual(method, "wazaari")

    def test_osaekomi_state(self):
        state = self.ruleset.get_default_state()
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "START_OSAEKOMI", {"corner": "shiro", "start_timestamp": 1234567890}
        )
        self.assertEqual(state["osaekomi"]["active_for"], "shiro")
        self.assertEqual(state["osaekomi"]["start_timestamp"], 1234567890)

        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "STOP_OSAEKOMI", {}
        )
        self.assertIsNone(state["osaekomi"]["active_for"])

    def test_judo_sub_actions_and_direct_hansoku(self):
        state = self.ruleset.get_default_state()

        # Test ADD_HANSOKU_MAKE
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_HANSOKU_MAKE", {"corner": "shiro"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "ao")
        self.assertEqual(method, "hansoku")

        # Test SUB_HANSOKU_MAKE
        state, is_finished, _, _ = self.ruleset.apply_ruleset_event(
            state, "SUB_HANSOKU_MAKE", {"corner": "shiro"}
        )
        self.assertFalse(state["penalties"]["shiro"]["hansoku_make"])

        # Test SUB_WAZA_ARI
        state["scores"]["shiro"]["waza_ari"] = 1
        state, _, _, _ = self.ruleset.apply_ruleset_event(
            state, "SUB_WAZA_ARI", {"corner": "shiro"}
        )
        self.assertEqual(state["scores"]["shiro"]["waza_ari"], 0)

        # Test SUB_IPPON
        state["scores"]["shiro"]["ippon"] = 1
        state, _, _, _ = self.ruleset.apply_ruleset_event(state, "SUB_IPPON", {"corner": "shiro"})
        self.assertEqual(state["scores"]["shiro"]["ippon"], 0)

        # Test SUB_SHIDO
        state["penalties"]["shiro"]["shido"] = 1
        state, _, _, _ = self.ruleset.apply_ruleset_event(state, "SUB_SHIDO", {"corner": "shiro"})
        self.assertEqual(state["penalties"]["shiro"]["shido"], 0)

    def test_judo_golden_score_win_ao(self):
        state = self.ruleset.get_default_state()
        state["is_golden_score"] = True
        state, is_finished, winner, method = self.ruleset.apply_ruleset_event(
            state, "ADD_IPPON", {"corner": "ao"}
        )
        self.assertTrue(is_finished)
        self.assertEqual(winner, "ao")
        self.assertEqual(method, "ippon")


class TaekwondoWTExtraTest(TestCase):
    def setUp(self):
        from apps.rulesets.taekwondo_wt import TaekwondoWTRuleSet

        self.ruleset = TaekwondoWTRuleSet()

    def test_reset_round(self):
        state = self.ruleset.get_default_state()
        state["scores"] = {"chung": 5, "hong": 3}
        state["gam_jeoms"] = {"chung": 2, "hong": 1}

        state, _, _, _ = self.ruleset.apply_ruleset_event(state, "RESET_ROUND", {})
        self.assertEqual(state["scores"]["chung"], 0)
        self.assertEqual(state["gam_jeoms"]["chung"], 0)

    def test_undo_round(self):
        state = self.ruleset.get_default_state()

        # Advance to round 2
        state["scores"] = {"chung": 5, "hong": 2}
        state, _, _, _ = self.ruleset.apply_ruleset_event(state, "NEXT_ROUND", {})
        self.assertEqual(state["current_round"], 2)

        # Undo round
        state, _, _, _ = self.ruleset.apply_ruleset_event(state, "UNDO_ROUND", {})
        self.assertEqual(state["current_round"], 1)
        self.assertEqual(state["scores"]["chung"], 5)
        self.assertEqual(state["scores"]["hong"], 2)


class MockBout:
    def __init__(
        self,
        status,
        winner_id=None,
        score_first=0,
        score_second=0,
        bout_index=1,
        win_method="points",
    ):
        self.status = status
        self.winner_id = winner_id
        self.score_first = score_first
        self.score_second = score_second
        self.bout_index = bout_index
        self.win_method = win_method


class MockCategory:
    def __init__(self, team_size=3):
        self.team_size = team_size


class MockTeamMatch:
    def __init__(self, reg_first_id, reg_second_id, bouts, team_size=3):
        self.reg_first_id = reg_first_id
        self.reg_second_id = reg_second_id

        class BoutsManager:
            def __init__(self, list_bouts):
                self.list_bouts = list_bouts

            def all(self):
                return self.list_bouts

        self.team_bouts = BoutsManager(bouts)
        self.category = MockCategory(team_size)


class BaseRuleSetTeamWinnerTest(TestCase):
    def setUp(self):
        from apps.rulesets.judo_ijf import JudoIJFRuleSet

        self.ruleset = JudoIJFRuleSet()

    def test_missing_registrations(self):
        match = MockTeamMatch(None, 2, [])
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertFalse(is_finished)

    def test_mathematical_win(self):
        bouts = [
            MockBout("completed", winner_id=1),
            MockBout("completed", winner_id=1),
        ]
        match = MockTeamMatch(1, 2, bouts, team_size=3)
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertTrue(is_finished)
        self.assertEqual(winner, 1)

    def test_all_regular_bouts_completed_win_by_wins(self):
        bouts = [
            MockBout("completed", winner_id=1, score_first=2, score_second=0, bout_index=1),
            MockBout("completed", winner_id=2, score_first=0, score_second=2, bout_index=2),
            MockBout("completed", winner_id=1, score_first=2, score_second=0, bout_index=3),
        ]
        match = MockTeamMatch(1, 2, bouts, team_size=3)
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertTrue(is_finished)
        self.assertEqual(winner, 1)

    def test_win_by_points(self):
        bouts = [
            MockBout("completed", winner_id=1, score_first=10, score_second=0, bout_index=1),
            MockBout("completed", winner_id=2, score_first=0, score_second=5, bout_index=2),
            MockBout("completed", winner_id=None, score_first=0, score_second=0, bout_index=3),
        ]
        match = MockTeamMatch(1, 2, bouts, team_size=3)
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertTrue(is_finished)
        self.assertEqual(winner, 1)

    def test_absolute_draw_no_extra_bout(self):
        bouts = [
            MockBout("completed", winner_id=1, score_first=5, score_second=0, bout_index=1),
            MockBout("completed", winner_id=2, score_first=0, score_second=5, bout_index=2),
            MockBout("completed", winner_id=None, score_first=0, score_second=0, bout_index=3),
        ]
        match = MockTeamMatch(1, 2, bouts, team_size=3)
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertFalse(is_finished)
        self.assertIsNone(winner)

    def test_absolute_draw_with_extra_bout(self):
        bouts = [
            MockBout("completed", winner_id=1, score_first=5, score_second=0, bout_index=1),
            MockBout("completed", winner_id=2, score_first=0, score_second=5, bout_index=2),
            MockBout("completed", winner_id=None, score_first=0, score_second=0, bout_index=3),
            MockBout(
                "completed",
                winner_id=2,
                score_first=1,
                score_second=0,
                bout_index=4,
                win_method="ippon",
            ),
        ]
        match = MockTeamMatch(1, 2, bouts, team_size=3)
        is_finished, winner, method = self.ruleset.determine_team_winner(match)
        self.assertTrue(is_finished)
        self.assertEqual(winner, 2)
        self.assertEqual(method, "ippon")
