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
