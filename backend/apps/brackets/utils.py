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
    slots: list,
    max_attempts: int = 100,
    rng=None,
):
    """TODO: розведення одноклубників — потрібна доопрацювання."""
    return list(slots)


def _placeholder_resolve_club_conflicts
    return list(slots)
