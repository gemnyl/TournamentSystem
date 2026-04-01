"""
Математичні утиліти для генерації турнірних сіток.

Функції навмисно реалізовані як pure functions без залежності від
Django ORM — це робить їх легко тестованими, детермінованими
та потенційно придатними до перевикористання у інших проектах.

Базовий принцип формування сітки single-elimination:
    1. Обчислюємо найближчий більший (чи рівний) ступінь двійки N = 2^k.
    2. Якщо учасників менше за N — решту слотів заповнюємо BYE-прохідниками,
       які автоматично "програють" найсильнішим посівам.
    3. Посіви розподіляємо за стандартним алгоритмом standard bracket seeding:
       1 vs N, 2 vs N-1, і т.д. у першому раунді, з поглибленим правильним
       порядком для наступних раундів (див. generate_seed_positions).
    4. Перевіряємо, чи не зустрічаються одноклубники до півфіналу,
       і за необхідності міняємо слоти місцями (див. resolve_club_conflicts).
"""
from __future__ import annotations
import math
import random
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Допоміжні структури
# ---------------------------------------------------------------------------

@dataclass
class Participant:
    """Спрощене представлення учасника для алгоритмів.

    Не залежить від Django моделей, щоб утиліти можна було тестувати
    у відриві від БД. У продуктивному коді створюється з об'єкта Registration.
    """
    id: int
    full_name: str
    club_id: int | None = None
    seed: int | None = None  # попередній рейтинг (1 = найсильніший)

    def __repr__(self):
        return f'P({self.id}:{self.full_name})'


# Спеціальне значення, що позначає BYE (автоматичний прохід)
BYE: Participant = Participant(id=-1, full_name='BYE', club_id=None, seed=None)


# ---------------------------------------------------------------------------
# Базова математика сітки
# ---------------------------------------------------------------------------

def next_power_of_two(n: int) -> int:
    """Найближчий ступінь двійки, не менший за n."""
    if n < 1:
        raise ValueError('n має бути ≥ 1')
    if n == 1:
        return 1
    return 1 << (n - 1).bit_length()


def calculate_byes(participant_count: int) -> int:
    """Кількість BYE-проходів, потрібних щоб доповнити сітку до 2^k."""
    if participant_count < 2:
        raise ValueError('Турнір вимагає щонайменше 2 учасників')
    return next_power_of_two(participant_count) - participant_count


def calculate_round_count(participant_count: int) -> int:
    """Кількість раундів у single-elimination сітці."""
    return int(math.ceil(math.log2(next_power_of_two(participant_count))))


def generate_seed_positions(bracket_size: int) -> list[int]:
    """Генерує стандартний порядок посівів у сітці розміру bracket_size."""
    if bracket_size < 1 or (bracket_size & (bracket_size - 1)) != 0:
        raise ValueError('bracket_size має бути ступенем двійки')

    positions = [1, 2]
    while len(positions) < bracket_size:
        n = len(positions) * 2
        new_positions = []
        for p in positions:
            new_positions.append(p)
            new_positions.append(n + 1 - p)
        positions = new_positions
    return positions


# ---------------------------------------------------------------------------
# Розведення одноклубників
# ---------------------------------------------------------------------------

def resolve_club_conflicts(
    slots: list[Participant | None],
    max_attempts: int = 100,
    rng: random.Random | None = None,
) -> list[Participant | None]:
    """Намагається перемістити учасників так, щоб одноклубники не зустрічались
    у першому раунді."""
    rng = rng or random.Random()
    slots = list(slots)
    n = len(slots)

    def first_round_pairs(s):
        return [(s[i], s[i + 1]) for i in range(0, n, 2)]

    def count_conflicts(s):
        return sum(
            1 for a, b in first_round_pairs(s)
            if a and b and a.club_id is not None and a.club_id == b.club_id
        )

    best = list(slots)
    best_conflicts = count_conflicts(best)

    for _ in range(max_attempts):
        if best_conflicts == 0:
            break
        current = list(best)
        conflict_idx = None
        for i in range(0, n, 2):
            a, b = current[i], current[i + 1]
            if a and b and a.club_id is not None and a.club_id == b.club_id:
                conflict_idx = i
                break
        if conflict_idx is None:
            break
        swap_with = rng.randrange(n)
        if swap_with == conflict_idx + 1:
            continue
        current[conflict_idx + 1], current[swap_with] = (
            current[swap_with], current[conflict_idx + 1]
        )
        c = count_conflicts(current)
        if c < best_conflicts:
            best = current
            best_conflicts = c

    return best


# ---------------------------------------------------------------------------
# Single elimination
# ---------------------------------------------------------------------------

def build_single_elimination_slots(
    participants: list[Participant],
    avoid_club_conflicts: bool = True,
    rng: random.Random | None = None,
) -> list[Participant | None]:
    """Повертає впорядкований список слотів першого раунду."""
    if not participants:
        raise ValueError('Потрібен хоча б один учасник')

    bracket_size = next_power_of_two(len(participants))
    positions = generate_seed_positions(bracket_size)

    ordered = sorted(
        participants,
        key=lambda p: (p.seed is None, p.seed or 0, p.id),
    )

    padded: list[Participant | None] = list(ordered) + [None] * (bracket_size - len(ordered))

    slots: list[Participant | None] = [None] * bracket_size
    for seed_rank, participant in enumerate(padded, start=1):
        slot_index = positions.index(seed_rank)
        slots[slot_index] = participant

    if avoid_club_conflicts:
        slots = resolve_club_conflicts(slots, rng=rng)

    return slots


def build_single_elimination_tree(
    slots: list[Participant | None],
) -> list[list[dict]]:
    """Будує структуру матчів по раундах на основі слотів першого раунду."""
    if not slots:
        return []

    rounds = []
    # --- Перший раунд ---
    first_round = []
    auto_winners = []
    match_order = 1
    for i in range(0, len(slots), 2):
        a, b = slots[i], slots[i + 1]
        if a is None and b is None:
            auto_winners.append(None)
            continue
        if a is None:
            auto_winners.append(b)
            first_round.append({
                'round_index': 1,
                'match_order': match_order,
                'reg_first': None,
                'reg_second': b,
                'auto_winner': b,
                'is_bye': True,
            })
        elif b is None:
            auto_winners.append(a)
            first_round.append({
                'round_index': 1,
                'match_order': match_order,
                'reg_first': a,
                'reg_second': None,
                'auto_winner': a,
                'is_bye': True,
            })
        else:
            auto_winners.append(None)
            first_round.append({
                'round_index': 1,
                'match_order': match_order,
                'reg_first': a,
                'reg_second': b,
                'auto_winner': None,
                'is_bye': False,
            })
        match_order += 1
    rounds.append(first_round)

    # --- Наступні раунди ---
    current_size = len(slots) // 4
    round_index = 2
    while current_size >= 1:
        round_matches = []
        for i in range(current_size):
            a_auto = auto_winners[i * 2] if i * 2 < len(auto_winners) else None
            b_auto = auto_winners[i * 2 + 1] if i * 2 + 1 < len(auto_winners) else None
            round_matches.append({
                'round_index': round_index,
                'match_order': i + 1,
                'reg_first': a_auto,
                'reg_second': b_auto,
                'auto_winner': None,
                'is_bye': False,
            })
        rounds.append(round_matches)
        auto_winners = [None] * current_size
        current_size //= 2
        round_index += 1

    return rounds


# ---------------------------------------------------------------------------
# Round robin
# ---------------------------------------------------------------------------

def build_round_robin_schedule(
    participants: list[Participant],
) -> list[list[tuple[Participant | None, Participant | None]]]:
    """Генерує розклад кругового турніру за circle method."""
    if len(participants) < 2:
        raise ValueError('Round robin вимагає щонайменше 2 учасників')

    players: list[Participant | None] = list(participants)
    if len(players) % 2 == 1:
        players.append(None)

    n = len(players)
    rounds_count = n - 1
    schedule = []

    fixed = players[0]
    rotating = players[1:]

    for r in range(rounds_count):
        round_pairs = []
        round_pairs.append((fixed, rotating[0]))
        for i in range(1, n // 2):
            round_pairs.append((rotating[i], rotating[-i]))
        schedule.append(round_pairs)
        rotating = [rotating[-1]] + rotating[:-1]

    return schedule