"""
Сервіс генерації турнірних сіток.

Інкапсулює логіку створення записів Match у базі даних на основі списку
підтверджених заявок (Registration). Використовує pure-утиліти з utils.py
для математики та розведення, а всі операції запису обгорнуті у транзакції.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.brackets import utils
from apps.matches.models import Match
from apps.tournaments.models import Category, Registration


class BracketGenerator:
    """Генератор турнірних сіток для різних форматів."""

    def __init__(self, category: Category):
        self.category = category

    # ------------------------------------------------------------------
    # Публічний API
    # ------------------------------------------------------------------

    @transaction.atomic
    def generate(self) -> list[Match]:
        """Генерує сітку відповідно до bracket_format категорії."""
        self._validate_preconditions()

        fmt = self.category.bracket_format
        if fmt == Category.BracketFormat.SINGLE_ELIMINATION:
            return self.generate_single_elimination()
        if fmt == Category.BracketFormat.ROUND_ROBIN:
            return self.generate_round_robin()
        raise NotImplementedError(f"Формат {fmt} не підтримується у MVP")

    @transaction.atomic
    def generate_single_elimination(self) -> list[Match]:
        """Створює повне дерево single-elimination матчів."""
        self._validate_preconditions()
        registrations = self._get_confirmed_registrations()
        self._assign_seeds_if_missing(registrations)

        # Визначаємо тривалість таймера з категорії або рулсету
        duration_sec = self.category.match_duration_seconds
        if not duration_sec:
            try:
                from apps.rulesets.registry import get_ruleset

                ruleset = get_ruleset(self.category.ruleset_key)
                from apps.rulesets.base import PointsRuleSet

                if isinstance(ruleset, PointsRuleSet):
                    duration_sec = ruleset.get_default_duration_seconds()
            except Exception:
                pass
        duration_ms = (duration_sec * 1000) if duration_sec else 180000

        participants = [self._to_participant(r) for r in registrations]
        reg_by_id = {r.id: r for r in registrations}

        slots = utils.build_single_elimination_slots(participants, avoid_club_conflicts=True)
        tree = utils.build_single_elimination_tree(slots)

        created_by_round: list[list[Match]] = []

        for round_matches in reversed(tree):
            row = []
            for m in round_matches:
                next_match = None
                if created_by_round:
                    parent_idx = (m["match_order"] - 1) // 2
                    next_match = created_by_round[-1][parent_idx]

                match_obj = Match.objects.create(
                    category=self.category,
                    reg_first=reg_by_id.get(m["reg_first"].id) if m["reg_first"] else None,
                    reg_second=reg_by_id.get(m["reg_second"].id) if m["reg_second"] else None,
                    round_index=m["round_index"],
                    match_order=m["match_order"],
                    next_match=next_match,
                    status=Match.Status.SCHEDULED,
                    timer_duration_ms=duration_ms,
                )
                row.append(match_obj)
            created_by_round.append(row)

        all_matches: list[Match] = []
        for round_row in reversed(created_by_round):
            all_matches.extend(round_row)

        # ВИПРАВЛЕННЯ: Фільтруємо матчі, передаючи на обробку BYE лише перший раунд
        first_round_matches = [m for m in all_matches if m.round_index == 1]
        self._process_byes(first_round_matches)

        return all_matches

    @transaction.atomic
    def generate_round_robin(self) -> list[Match]:
        """Створює розклад кругового турніру."""
        self._validate_preconditions()
        registrations = self._get_confirmed_registrations()

        # Визначаємо тривалість таймера з категорії або рулсету
        duration_sec = self.category.match_duration_seconds
        if not duration_sec:
            try:
                from apps.rulesets.registry import get_ruleset

                ruleset = get_ruleset(self.category.ruleset_key)
                from apps.rulesets.base import PointsRuleSet

                if isinstance(ruleset, PointsRuleSet):
                    duration_sec = ruleset.get_default_duration_seconds()
            except Exception:
                pass
        duration_ms = (duration_sec * 1000) if duration_sec else 180000

        participants = [self._to_participant(r) for r in registrations]
        reg_by_id = {r.id: r for r in registrations}

        schedule = utils.build_round_robin_schedule(participants)

        created: list[Match] = []
        for round_idx, round_pairs in enumerate(schedule, start=1):
            order_idx = 1
            for a, b in round_pairs:
                if a is None or b is None:
                    continue
                match_obj = Match.objects.create(
                    category=self.category,
                    reg_first=reg_by_id[a.id],
                    reg_second=reg_by_id[b.id],
                    round_index=round_idx,
                    match_order=order_idx,
                    next_match=None,
                    status=Match.Status.SCHEDULED,
                    timer_duration_ms=duration_ms,
                )
                created.append(match_obj)
                order_idx += 1
        return created

    # ------------------------------------------------------------------
    # Приватні хелпери
    # ------------------------------------------------------------------

    def _validate_preconditions(self):
        if Match.objects.filter(category=self.category).exists():
            raise ValidationError(
                "Для цієї категорії сітку вже згенеровано. Видаліть існуючі "
                "матчі перед повторною генерацією."
            )
        count = self._get_confirmed_registrations().count()
        if count < 2:
            raise ValidationError(
                f"Для генерації сітки потрібно щонайменше 2 підтверджені "
                f"реєстрації (зараз {count})."
            )

    def _get_confirmed_registrations(self):
        return Registration.objects.filter(
            category=self.category,
            status=Registration.Status.CONFIRMED,
        ).select_related("athlete", "athlete__club")

    def _assign_seeds_if_missing(self, registrations):
        for idx, r in enumerate(registrations, start=1):
            if r.seed_number is None:
                r.assign_seed(idx)

    def _to_participant(self, registration) -> utils.Participant:
        return utils.Participant(
            id=registration.id,
            full_name=registration.athlete.get_full_name(),
            club_id=registration.athlete.club_id,
            seed=registration.seed_number,
        )

    def _process_byes(self, matches: list[Match]):
        for match in matches:
            has_first = match.reg_first is not None
            has_second = match.reg_second is not None
            if has_first and not has_second:
                winner = match.reg_first
            elif has_second and not has_first:
                winner = match.reg_second
            else:
                continue

            match.winner = winner
            match.win_method = Match.WinMethod.WALKOVER
            match.status = Match.Status.COMPLETED
            from django.utils import timezone

            match.completed_at = timezone.now()
            match.save(update_fields=["winner", "win_method", "status", "completed_at"])

            if match.next_match:
                nxt = match.next_match
                if match.match_order % 2 == 1:
                    nxt.reg_first = winner
                    nxt.save(update_fields=["reg_first"])
                else:
                    nxt.reg_second = winner
                    nxt.save(update_fields=["reg_second"])
