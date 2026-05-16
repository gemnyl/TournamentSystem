"""
Unit-тести для підсистеми генерації турнірних сіток.

Покривають:
    - математичну базу (next_power_of_two, byes, round count, seed positions);
    - розведення одноклубників (resolve_club_conflicts);
    - повний цикл single-elimination на 8 та 5 учасниках (BYE handling);
    - цикл round-robin на парній та непарній кількості учасників;
    - обробку некоректних передумов (менше 2 учасників, повторна генерація).

Для запуску:
    pytest apps/brackets/tests.py
або
    python manage.py test apps.brackets
"""

import random

import pytest

from apps.brackets import utils
from apps.brackets.utils import Participant

# ---------------------------------------------------------------------------
# Математична база (не потребує БД)
# ---------------------------------------------------------------------------


class TestBracketMath:
    def test_next_power_of_two_basic(self):
        assert utils.next_power_of_two(1) == 1
        assert utils.next_power_of_two(2) == 2
        assert utils.next_power_of_two(5) == 8
        assert utils.next_power_of_two(8) == 8
        assert utils.next_power_of_two(17) == 32

    def test_next_power_of_two_rejects_zero(self):
        with pytest.raises(ValueError):
            utils.next_power_of_two(0)

    def test_calculate_byes(self):
        assert utils.calculate_byes(8) == 0
        assert utils.calculate_byes(5) == 3
        assert utils.calculate_byes(9) == 7

    def test_calculate_byes_rejects_singleton(self):
        with pytest.raises(ValueError):
            utils.calculate_byes(1)

    def test_round_count(self):
        assert utils.calculate_round_count(2) == 1
        assert utils.calculate_round_count(8) == 3
        assert utils.calculate_round_count(5) == 3
        assert utils.calculate_round_count(32) == 5

    def test_seed_positions_power_of_two_required(self):
        with pytest.raises(ValueError):
            utils.generate_seed_positions(6)

    def test_seed_positions_standard_patterns(self):
        assert utils.generate_seed_positions(2) == [1, 2]
        assert utils.generate_seed_positions(4) == [1, 4, 2, 3]
        assert utils.generate_seed_positions(8) == [1, 8, 4, 5, 2, 7, 3, 6]
        # Перший посів зустріне другого лише у фіналі
        positions16 = utils.generate_seed_positions(16)
        assert positions16[0] == 1
        assert positions16.index(2) >= 8  # 2 має бути у другій половині сітки


# ---------------------------------------------------------------------------
# Розведення одноклубників
# ---------------------------------------------------------------------------


class TestClubSeeding:
    def test_resolve_conflicts_fixes_adjacent_club_mates(self):
        # 4 учасники, усі перші двоє з одного клубу — слід розвести
        slots = [
            Participant(1, "A1", club_id=10),
            Participant(2, "A2", club_id=10),  # конфлікт
            Participant(3, "A3", club_id=20),
            Participant(4, "A4", club_id=30),
        ]
        rng = random.Random(42)  # детермінований seed для тесту
        resolved = utils.resolve_club_conflicts(slots, rng=rng)
        # Після resolve конфліктів у першому раунді бути не повинно
        pair1 = (resolved[0], resolved[1])
        pair2 = (resolved[2], resolved[3])
        for a, b in (pair1, pair2):
            if a and b and a.club_id and b.club_id:
                assert a.club_id != b.club_id, f"Одноклубники {a} і {b} у першому раунді"

    def test_resolve_with_all_same_club_gracefully_degrades(self):
        # Усі з одного клубу — розвести неможливо, має не зависати
        slots = [Participant(i, f"A{i}", club_id=1) for i in range(1, 5)]
        rng = random.Random(42)
        result = utils.resolve_club_conflicts(slots, rng=rng)
        assert len(result) == 4


# ---------------------------------------------------------------------------
# Повний цикл побудови single-elimination
# ---------------------------------------------------------------------------


class TestSingleEliminationSlots:
    def test_eight_participants_full_bracket(self):
        participants = [Participant(i, f"A{i}", club_id=i % 4, seed=i) for i in range(1, 9)]
        slots = utils.build_single_elimination_slots(participants, avoid_club_conflicts=False)
        assert len(slots) == 8
        assert all(s is not None for s in slots)
        # Перший посів має бути на позиції 0
        assert slots[0].seed == 1

    def test_five_participants_bracket_padded_with_byes(self):
        participants = [Participant(i, f"A{i}", club_id=i, seed=i) for i in range(1, 6)]
        slots = utils.build_single_elimination_slots(participants, avoid_club_conflicts=False)
        assert len(slots) == 8
        none_count = sum(1 for s in slots if s is None)
        assert none_count == 3  # три BYE

    def test_tree_has_correct_number_of_rounds(self):
        participants = [Participant(i, f"A{i}", seed=i) for i in range(1, 9)]
        slots = utils.build_single_elimination_slots(participants)
        tree = utils.build_single_elimination_tree(slots)
        assert len(tree) == 3  # 1/4 → 1/2 → фінал
        assert len(tree[0]) == 4  # перший раунд — 4 матчі
        assert len(tree[-1]) == 1  # фінал — 1 матч

    def test_tree_for_five_has_auto_advances(self):
        participants = [Participant(i, f"A{i}", seed=i) for i in range(1, 6)]
        slots = utils.build_single_elimination_slots(participants)
        tree = utils.build_single_elimination_tree(slots)
        # Серед матчів першого раунду мають бути BYE
        first_round = tree[0]
        bye_count = sum(1 for m in first_round if m.get("is_bye"))
        assert bye_count == 3


# ---------------------------------------------------------------------------
# Round robin
# ---------------------------------------------------------------------------


class TestRoundRobin:
    def test_even_count_generates_n_minus_one_rounds(self):
        participants = [Participant(i, f"A{i}") for i in range(1, 5)]
        schedule = utils.build_round_robin_schedule(participants)
        assert len(schedule) == 3
        # У кожному турі має бути 2 пари
        for round_ in schedule:
            assert len(round_) == 2

    def test_odd_count_adds_bye(self):
        participants = [Participant(i, f"A{i}") for i in range(1, 6)]
        schedule = utils.build_round_robin_schedule(participants)
        assert len(schedule) == 5
        # У кожному турі хтось один вільний (пара з None)
        for round_ in schedule:
            has_bye = any(a is None or b is None for a, b in round_)
            assert has_bye

    def test_every_pair_plays_exactly_once(self):
        participants = [Participant(i, f"A{i}") for i in range(1, 7)]
        schedule = utils.build_round_robin_schedule(participants)
        seen_pairs = set()
        for round_ in schedule:
            for a, b in round_:
                if a and b:
                    key = tuple(sorted([a.id, b.id]))
                    assert key not in seen_pairs, f"Дубль пари: {key}"
                    seen_pairs.add(key)
        # Очікуване число пар = C(6, 2) = 15
        assert len(seen_pairs) == 15

    def test_rejects_single_participant(self):
        with pytest.raises(ValueError):
            utils.build_round_robin_schedule([Participant(1, "A1")])


# ---------------------------------------------------------------------------
# Інтеграційний тест BracketGenerator з БД (потребує Django)
# ---------------------------------------------------------------------------
# Цей блок коментується, якщо тести запускаються у pure pytest-режимі
# без django-settings. Запускати через: python manage.py test apps.brackets

try:
    from datetime import date, timedelta

    from django.test import TestCase
    from django.utils import timezone

    from apps.accounts.models import Club, User
    from apps.athletes.models import Athlete
    from apps.brackets.services import BracketGenerator
    from apps.matches.models import Match
    from apps.tournaments.models import Category, Registration, Tournament

    class BracketGeneratorIntegrationTest(TestCase):
        """Інтеграційний тест: створюємо турнір, учасників і перевіряємо
        що сітка генерується коректно і структура матчів цілісна."""

        def setUp(self):
            self.organizer = User.objects.create_user(
                email="org@test.local",
                password="test12345",
                first_name="Test",
                last_name="Organizer",
                role=User.Role.ORGANIZER,
            )
            self.coach = User.objects.create_user(
                email="coach@test.local",
                password="test12345",
                first_name="Test",
                last_name="Coach",
                role=User.Role.COACH,
            )
            self.club_a = Club.objects.create(name="Club A", region="Kyiv")
            self.club_b = Club.objects.create(name="Club B", region="Lviv")

            self.tournament = Tournament.objects.create(
                organizer=self.organizer,
                title="Test Cup 2026",
                sport_type="Karate",
                location="Zhytomyr",
                start_date=timezone.now() + timedelta(days=30),
                end_date=timezone.now() + timedelta(days=31),
                status=Tournament.Status.REGISTRATION,
            )
            self.category = Category.objects.create(
                tournament=self.tournament,
                name="Men -75kg",
                allowed_gender=Category.AllowedGender.MALE,
                min_age=18,
                max_age=35,
                min_weight=70,
                max_weight=75,
                bracket_format=Category.BracketFormat.SINGLE_ELIMINATION,
            )

        def _create_confirmed_registrations(self, count):
            regs = []
            for i in range(1, count + 1):
                club = self.club_a if i % 2 == 0 else self.club_b
                athlete = Athlete.objects.create(
                    coach=self.coach,
                    club=club,
                    first_name=f"Name{i}",
                    last_name=f"Surname{i}",
                    gender=Athlete.Gender.MALE,
                    birth_date=date(2000, 1, 1),
                    base_weight=73,
                )
                reg = Registration.objects.create(
                    athlete=athlete,
                    category=self.category,
                    seed_number=i,
                    recorded_weight=73,
                    status=Registration.Status.CONFIRMED,
                )
                regs.append(reg)
            return regs

        def test_single_elimination_8_creates_7_matches(self):
            self._create_confirmed_registrations(8)
            gen = BracketGenerator(self.category)
            gen.generate_single_elimination()
            # 8 учасників → 7 матчів (4+2+1)
            assert Match.objects.filter(category=self.category).count() == 7

            # Фінал — єдиний матч без next_match
            finals = Match.objects.filter(category=self.category, next_match__isnull=True)
            assert finals.count() == 1

        def test_single_elimination_5_creates_bracket_with_byes(self):
            self._create_confirmed_registrations(5)
            gen = BracketGenerator(self.category)
            gen.generate_single_elimination()
            # 5 учасників → сітка з 8 слотів → 7 матчів
            assert Match.objects.filter(category=self.category).count() == 7
            # BYE-матчі мають статус COMPLETED з walkover
            walkovers = Match.objects.filter(
                category=self.category,
                win_method=Match.WinMethod.WALKOVER,
            )
            assert walkovers.count() == 3

        def test_round_robin_6_creates_15_matches(self):
            self.category.bracket_format = Category.BracketFormat.ROUND_ROBIN
            self.category.save()
            self._create_confirmed_registrations(6)
            gen = BracketGenerator(self.category)
            gen.generate_round_robin()
            # C(6,2) = 15 пар
            assert Match.objects.filter(category=self.category).count() == 15

        def test_rejects_generation_if_already_generated(self):
            self._create_confirmed_registrations(4)
            gen = BracketGenerator(self.category)
            gen.generate_single_elimination()
            with pytest.raises(Exception, match=".*"):
                gen.generate_single_elimination()

        def test_rejects_with_less_than_two_participants(self):
            self._create_confirmed_registrations(1)
            gen = BracketGenerator(self.category)
            with pytest.raises(Exception, match=".*"):
                gen.generate()

except ImportError:
    # Django не налаштовано — інтеграційні тести пропускаються
    pass
