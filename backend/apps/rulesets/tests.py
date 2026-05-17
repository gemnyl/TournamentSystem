from django.test import TestCase

from apps.rulesets.base import MatchState, ScoreEvent
from apps.rulesets.karate_wkf import KarateWKFRuleSet
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
