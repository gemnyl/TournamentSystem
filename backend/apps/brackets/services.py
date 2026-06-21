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

        if self.category.is_team:
            registrations = self._get_confirmed_registrations()
            count = registrations.count()
            if count >= 6:
                fmt = Category.BracketFormat.SINGLE_ELIMINATION
            else:
                fmt = Category.BracketFormat.ROUND_ROBIN
            self.category.bracket_format = fmt
            self.category.save(update_fields=["bracket_format"])
        else:
            fmt = self.category.bracket_format

        if fmt == Category.BracketFormat.SINGLE_ELIMINATION:
            return self.generate_single_elimination()
        if fmt == Category.BracketFormat.ROUND_ROBIN:
            return self.generate_round_robin()
        if fmt == Category.BracketFormat.SINGLE_ELIM_REPECHAGE:
            return self.generate_single_elimination()
        if fmt == Category.BracketFormat.DOUBLE_ELIMINATION:
            return self.generate_double_elimination()
        if fmt == Category.BracketFormat.SWISS:
            return self.generate_swiss_round_1()
        raise NotImplementedError(f"Формат {fmt} не підтримується")

    @transaction.atomic
    def generate_single_elimination(self) -> list[Match]:
        """Створює повне дерево single-elimination матчів."""
        self._validate_preconditions()
        registrations = self._get_confirmed_registrations()
        self._assign_seeds_if_missing(registrations)

        duration_ms = self._get_match_duration_ms()

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

        duration_ms = self._get_match_duration_ms()

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

    @transaction.atomic
    def generate_swiss_round_1(self) -> list[Match]:
        """Генерує перший раунд швейцарської системи."""
        self._validate_preconditions()
        registrations = self._get_confirmed_registrations()
        self._assign_seeds_if_missing(registrations)

        duration_ms = self._get_match_duration_ms()
        participants = [self._to_participant(r) for r in registrations]
        reg_by_id = {r.id: r for r in registrations}

        # Сортуємо учасників за посівом (seed) або по ID
        participants.sort(key=lambda p: p.seed if p.seed is not None else p.id)

        n = len(participants)
        if n < 2:
            raise ValidationError("Швейцарська система вимагає щонайменше 2 учасників")

        pairings = []
        bye_player = None

        if n % 2 != 0:
            # Непарна кількість: останній (найслабший) отримує вільний тур (Bye)
            bye_player = participants[-1]
            active_players = participants[:-1]
        else:
            active_players = participants

        # Спрямовуємо першу половину на другу (1-й проти N/2+1, і т.д.)
        half = len(active_players) // 2
        for i in range(half):
            pairings.append((active_players[i], active_players[i + half]))

        created_matches = []
        order_idx = 1

        # Створюємо матчі для першого раунду
        for a, b in pairings:
            match_obj = Match.objects.create(
                category=self.category,
                reg_first=reg_by_id[a.id],
                reg_second=reg_by_id[b.id],
                round_index=1,
                match_order=order_idx,
                status=Match.Status.SCHEDULED,
                timer_duration_ms=duration_ms,
            )
            created_matches.append(match_obj)
            order_idx += 1

        # Якщо є гравець з Bye, створюємо для нього завершений матч
        if bye_player:
            match_obj = Match.objects.create(
                category=self.category,
                reg_first=reg_by_id[bye_player.id],
                reg_second=None,
                round_index=1,
                match_order=order_idx,
                status=Match.Status.COMPLETED,
                winner=reg_by_id[bye_player.id],
                win_method=Match.WinMethod.WALKOVER,
                timer_duration_ms=duration_ms,
            )
            created_matches.append(match_obj)

        return created_matches

    def _get_match_duration_ms(self) -> int:
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
        return (duration_sec * 1000) if duration_sec else 180000

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
            payment_status="paid",
        ).select_related("athlete", "athlete__club", "team", "team__club")

    def _assign_seeds_if_missing(self, registrations):
        for idx, r in enumerate(registrations, start=1):
            if r.seed_number is None:
                r.assign_seed(idx)

    def _to_participant(self, registration) -> utils.Participant:
        if registration.team:
            return utils.Participant(
                id=registration.id,
                full_name=registration.team.name,
                club_id=registration.team.club_id,
                seed=registration.seed_number,
            )
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

    @transaction.atomic
    def generate_double_elimination(self) -> list[Match]:
        """Створює повне дерево double-elimination матчів."""
        self._validate_preconditions()
        registrations = self._get_confirmed_registrations()
        self._assign_seeds_if_missing(registrations)

        duration_ms = self._get_match_duration_ms()

        participants = [self._to_participant(r) for r in registrations]
        reg_by_id = {r.id: r for r in registrations}

        slots = utils.build_single_elimination_slots(participants, avoid_club_conflicts=True)
        bracket_size = utils.next_power_of_two(len(participants))
        import math

        k = int(math.ceil(math.log2(bracket_size)))

        # 1. Create Grand Final (round_index = 200, match_order = 1)
        gf_match = Match.objects.create(
            category=self.category,
            round_index=200,
            match_order=1,
            status=Match.Status.SCHEDULED,
            timer_duration_ms=duration_ms,
        )

        losers_matches = {}

        # 2. Create Losers Bracket bottom-up
        for lvl in range(2 * k - 2, 0, -1):
            M = bracket_size // (2 ** ((lvl + 3) // 2))
            for m in range(1, M + 1):
                if lvl == 2 * k - 2:
                    next_match = gf_match
                elif lvl % 2 == 1:
                    next_match = losers_matches[(lvl + 1, m)]
                else:
                    next_match = losers_matches[(lvl + 1, (m + 1) // 2)]

                match_obj = Match.objects.create(
                    category=self.category,
                    round_index=100 + lvl,
                    match_order=m,
                    next_match=next_match,
                    status=Match.Status.SCHEDULED,
                    timer_duration_ms=duration_ms,
                )
                losers_matches[(lvl, m)] = match_obj

        # 3. Create Winners Bracket bottom-up
        winners_matches = {}
        for r in range(k, 0, -1):
            M = bracket_size // (2**r)
            for m in range(1, M + 1):
                if r == k:
                    next_match = gf_match
                else:
                    next_match = winners_matches[(r + 1, (m + 1) // 2)]

                if r == 1:
                    loser_next_match = losers_matches[(1, (m + 1) // 2)]
                else:
                    loser_next_match = losers_matches[(2 * r - 2, M - m + 1)]

                reg_first = None
                reg_second = None
                if r == 1:
                    slot_first = slots[2 * m - 2]
                    slot_second = slots[2 * m - 1]
                    if slot_first:
                        reg_first = reg_by_id.get(slot_first.id)
                    if slot_second:
                        reg_second = reg_by_id.get(slot_second.id)

                match_obj = Match.objects.create(
                    category=self.category,
                    reg_first=reg_first,
                    reg_second=reg_second,
                    round_index=r,
                    match_order=m,
                    next_match=next_match,
                    loser_next_match=loser_next_match,
                    status=Match.Status.SCHEDULED,
                    timer_duration_ms=duration_ms,
                )
                winners_matches[(r, m)] = match_obj

        # 4. Resolve all BYEs
        self._process_byes_for_category(self.category)

        return list(
            Match.objects.filter(category=self.category).order_by("round_index", "match_order")
        )

    def _process_byes_for_category(self, category):
        from django.db.models import Q
        from django.utils import timezone

        while True:
            updated = False
            matches = list(Match.objects.filter(category=category))

            for match in matches:
                match.refresh_from_db()
                if match.status != Match.Status.SCHEDULED:
                    continue

                # Predecessors are matches that feed into this match
                predecessors = list(
                    Match.objects.filter(Q(next_match=match) | Q(loser_next_match=match))
                )

                if all(p.status == Match.Status.COMPLETED for p in predecessors):
                    has_first = match.reg_first_id is not None
                    has_second = match.reg_second_id is not None

                    if not has_first and not has_second:
                        match.status = Match.Status.COMPLETED
                        match.completed_at = timezone.now()
                        match.save(update_fields=["status", "completed_at"])
                        updated = True
                    elif has_first and not has_second:
                        match.winner = match.reg_first
                        match.win_method = Match.WinMethod.WALKOVER
                        match.status = Match.Status.COMPLETED
                        match.completed_at = timezone.now()
                        match.save(update_fields=["winner", "win_method", "status", "completed_at"])
                        match.advance_participant()
                        updated = True
                    elif has_second and not has_first:
                        match.winner = match.reg_second
                        match.win_method = Match.WinMethod.WALKOVER
                        match.status = Match.Status.COMPLETED
                        match.completed_at = timezone.now()
                        match.save(update_fields=["winner", "win_method", "status", "completed_at"])
                        match.advance_participant()
                        updated = True
            if not updated:
                break

    @transaction.atomic
    def generate_next_swiss_round(self) -> list[Match]:
        """Генерує наступний раунд швейцарської системи."""
        if self.category.bracket_format != Category.BracketFormat.SWISS:
            raise ValidationError("Цей метод підтримується тільки для швейцарської системи.")

        # Перевіряємо, чи є незіграні поєдинки в попередніх раундах
        active_matches = self.category.matches.exclude(status=Match.Status.COMPLETED)
        if active_matches.exists():
            raise ValidationError(
                "Не можна згенерувати наступний тур, поки тривають поєдинки поточного туру."
            )

        # Отримуємо всі наявні матчі категорії
        existing_matches = list(self.category.matches.filter(parent_team_match__isnull=True))
        if not existing_matches:
            raise ValidationError("Спочатку потрібно згенерувати перший раунд сітки.")

        # Раунд, який зараз завершився
        current_round = max(m.round_index for m in existing_matches)

        # Кількість підтверджених учасників
        registrations = list(
            self.category.registrations.filter(status=Registration.Status.CONFIRMED)
        )
        n = len(registrations)
        if n < 2:
            raise ValidationError("Недостатньо учасників для генерації раунду.")

        import math

        max_rounds = math.ceil(math.log2(n))
        if current_round >= max_rounds:
            raise ValidationError(
                f"Усі тури швейцарської системи вже зіграні (ліміт: {max_rounds})."
            )

        # Розраховуємо standings для отримання поточних балів гравців
        from apps.tournaments.services import calculate_category_standings

        results_data = calculate_category_standings(self.category, persist=False)
        reg_by_id = {r.id: r for r in registrations}

        # Створюємо допоміжні об'єкти для алгоритму парування
        class SwissPlayer:
            def __init__(self, reg_id, score):
                self.id = reg_id
                self.score = score

        players = []
        for res in results_data:
            reg = res["registration"]
            score = float(res.get("points", 0))
            players.append(SwissPlayer(reg.id, score))

        # Отримуємо історію Byes та суперників
        past_opponents = {r.id: set() for r in registrations}
        players_with_byes = set()

        for m in existing_matches:
            if m.reg_first_id and m.reg_second_id:
                past_opponents[m.reg_first_id].add(m.reg_second_id)
                past_opponents[m.reg_second_id].add(m.reg_first_id)
            elif m.reg_first_id and not m.reg_second_id:
                players_with_byes.add(m.reg_first_id)
            elif m.reg_second_id and not m.reg_first_id:
                players_with_byes.add(m.reg_second_id)

        # Сортуємо гравців за балами спадно (tie-break за ID для стабільності)
        players.sort(key=lambda p: (p.score, -p.id), reverse=True)

        bye_player = None
        if len(players) % 2 != 0:
            # Непарна кількість: обираємо Bye гравця
            # Шукаємо гравця з найменшими балами, який ще не отримував Bye
            bye_candidate = None
            for p in reversed(players):
                if p.id not in players_with_byes:
                    bye_candidate = p
                    break

            if bye_candidate is None:
                bye_candidate = players[-1]

            bye_player = bye_candidate
            active_players = [p for p in players if p.id != bye_player.id]
        else:
            active_players = players

        pairings = utils.pair_swiss_optimal(active_players, past_opponents)

        if pairings is None:
            raise ValidationError(
                "Неможливо математично сформувати нові пари без "
                "повторень поєдинків. Перевірте результати."
            )

        # Отримуємо тривалість поєдинку та татамі
        first_match = existing_matches[0]
        duration_ms = first_match.timer_duration_ms
        tatami = first_match.tatami

        created_matches = []
        next_round_index = current_round + 1
        order_idx = 1

        for a, b in pairings:
            match_obj = Match.objects.create(
                category=self.category,
                reg_first=reg_by_id[a.id],
                reg_second=reg_by_id[b.id],
                round_index=next_round_index,
                match_order=order_idx,
                tatami=tatami,
                status=Match.Status.SCHEDULED,
                timer_duration_ms=duration_ms,
            )
            created_matches.append(match_obj)
            order_idx += 1

        if bye_player:
            match_obj = Match.objects.create(
                category=self.category,
                reg_first=reg_by_id[bye_player.id],
                reg_second=None,
                round_index=next_round_index,
                match_order=order_idx,
                tatami=tatami,
                status=Match.Status.COMPLETED,
                winner=reg_by_id[bye_player.id],
                win_method=Match.WinMethod.WALKOVER,
                timer_duration_ms=duration_ms,
            )
            created_matches.append(match_obj)

        # Трансляція змін на татамі та результатів
        from django.db.models import Q

        from apps.common.broadcast import broadcast_category_results_update, broadcast_tatami_state
        from apps.tatamis.models import Tatami

        matching_tatamis = Tatami.objects.filter(
            Q(current_match__category=self.category) | Q(active_results_category=self.category)
        )
        for t in matching_tatamis:
            broadcast_tatami_state(t)

        broadcast_category_results_update(self.category.id)

        if tatami:
            broadcast_tatami_state(tatami)

        return created_matches


class RepechageService:
    @staticmethod
    @transaction.atomic
    def generate_for_category(category: Category):
        # 1. Check if repechage matches already exist to avoid double generation
        if Match.objects.filter(category=category, round_index__gte=300).exists():
            return

        # 2. Find the final match (next_match is None)
        final_match = Match.objects.filter(
            category=category, next_match__isnull=True, round_index__lt=300
        ).first()
        if not final_match:
            return

        # 3. Check if both finalists (reg_first and reg_second) are present
        if not final_match.reg_first or not final_match.reg_second:
            return

        # Fetch the tatami assigned to this category's matches
        existing_match = Match.objects.filter(category=category, tatami__isnull=False).first()
        tatami = existing_match.tatami if existing_match else None

        # 4. Generate repechage for each pool
        # Pool A (finalist = final_match.reg_first, match_order = 1)
        # Pool B (finalist = final_match.reg_second, match_order = 2)
        RepechageService._generate_pool_chain(category, final_match.reg_first, 1, tatami)
        RepechageService._generate_pool_chain(category, final_match.reg_second, 2, tatami)

        # 5. Broadcast category results update
        from apps.common.broadcast import broadcast_category_results_update

        broadcast_category_results_update(category.id)

    @staticmethod
    def _generate_pool_chain(
        category: Category, finalist: Registration, pool_index: int, tatami=None
    ):
        matches_won = Match.objects.filter(category=category, winner=finalist).order_by(
            "round_index"
        )
        defeated_regs = []
        for m in matches_won:
            if m.next_match is None:
                continue
            opponent = m.reg_second if finalist == m.reg_first else m.reg_first
            if opponent:
                defeated_regs.append(opponent)

        p = len(defeated_regs)
        if p < 2:
            if p == 1:
                # 3rd place is automatically assigned
                r = defeated_regs[0]
                r.place = 3
                r.save(update_fields=["place"])
            return

        # Determine duration
        duration_sec = category.match_duration_seconds
        if not duration_sec:
            try:
                from apps.rulesets.registry import get_ruleset

                ruleset = get_ruleset(category.ruleset_key)
                from apps.rulesets.base import PointsRuleSet

                if isinstance(ruleset, PointsRuleSet):
                    duration_sec = ruleset.get_default_duration_seconds()
            except Exception:
                pass
        duration_ms = (duration_sec * 1000) if duration_sec else 180000

        # Create the chain bottom-up (to link next_match easily)
        next_match = None
        for j in range(p - 1, 0, -1):
            reg_first = defeated_regs[0] if j == 1 else None
            reg_second = defeated_regs[1] if j == 1 else defeated_regs[j]

            match_obj = Match.objects.create(
                category=category,
                tatami=tatami,
                reg_first=reg_first,
                reg_second=reg_second,
                round_index=300 + j,
                match_order=pool_index,
                next_match=next_match,
                status=Match.Status.SCHEDULED,
                timer_duration_ms=duration_ms,
            )
            next_match = match_obj
