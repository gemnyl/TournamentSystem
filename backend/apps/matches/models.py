"""
Модель поєдинку.

Ключове архітектурне рішення — рекурсивний FK next_match, який формує
орієнтований граф турнірної сітки безпосередньо на рівні БД
(див. п. 2.2 пояснювальної записки, таблиця 2.8).
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction


class Match(models.Model):
    """Поєдинок між двома учасниками у межах категорії."""

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Заплановано"
        ONGOING = "ongoing", "Триває"
        COMPLETED = "completed", "Завершено"

    class WinMethod(models.TextChoices):
        DECISION = "decision", "За рішенням суддів"
        DISQUALIFICATION = "disqualification", "Дискваліфікація"
        WALKOVER = "walkover", "Неявка суперника"
        WITHDRAWAL = "withdrawal", "Знято з поєдинку"
        POINTS = "points", "За очками"
        HANTEI = "hantei", "Hantei (рішення суддів)"
        HANSOKU = "hansoku", "Hansoku (дискваліфікація)"
        KIKEN = "kiken", "Kiken (відмова від участі)"
        IPPON = "ippon", "Ippon"
        WAZAARI = "wazaari", "Waza-ari"

    class Senshu(models.TextChoices):
        NONE = "none", "None"
        AKA = "aka", "Aka"
        AO = "ao", "Ao"

    category = models.ForeignKey(
        "tournaments.Category",
        on_delete=models.CASCADE,
        related_name="matches",
        verbose_name="Категорія",
    )
    reg_first = models.ForeignKey(
        "tournaments.Registration",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matches_as_first",
        verbose_name="Учасник 1",
    )
    reg_second = models.ForeignKey(
        "tournaments.Registration",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matches_as_second",
        verbose_name="Учасник 2",
    )
    round_index = models.PositiveSmallIntegerField(
        verbose_name="Номер раунду", help_text="1 = перший раунд, 2 = 1/8, 3 = 1/4 тощо"
    )
    match_order = models.PositiveSmallIntegerField(verbose_name="Порядковий номер у раунді")
    tatami_number = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="Номер татамі"
    )
    score_first = models.IntegerField(default=0, verbose_name="Бали учасника 1")
    score_second = models.IntegerField(default=0, verbose_name="Бали учасника 2")
    warnings_first = models.IntegerField(default=0, verbose_name="Попередження уч. 1")
    warnings_second = models.IntegerField(default=0, verbose_name="Попередження уч. 2")
    winner = models.ForeignKey(
        "tournaments.Registration",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="won_matches",
        verbose_name="Переможець",
    )
    win_method = models.CharField(
        max_length=100, choices=WinMethod.choices, blank=True, verbose_name="Спосіб перемоги"
    )
    match_duration = models.PositiveIntegerField(
        null=True, blank=True, verbose_name="Тривалість (сек)"
    )
    next_match = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="prev_matches",
        verbose_name="Наступний матч",
        help_text="Ключ рекурсивного дерева сітки. Null → фінал.",
    )
    loser_next_match = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loser_prev_matches",
        verbose_name="Матч для того, хто програв",
        help_text="Для double elimination (у MVP не використовується)",
    )
    senshu = models.CharField(
        max_length=4,
        choices=Senshu.choices,
        default=Senshu.NONE,
        verbose_name="Senshu (перша атака)",
    )
    flags_aka = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="Прапори Aka (Kata)"
    )
    flags_ao = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="Прапори Ao (Kata)"
    )
    judges_count = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="Кількість суддів (Kata)"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED, verbose_name="Статус"
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "match"
        verbose_name = "Поєдинок"
        verbose_name_plural = "Поєдинки"
        ordering = ["category", "round_index", "match_order"]
        indexes = [
            models.Index(
                fields=["category", "round_index", "match_order"], name="idx_match_bracket_pos"
            ),
            models.Index(fields=["status"], name="idx_match_status"),
        ]

    def __str__(self):
        f = self.reg_first.athlete.get_full_name() if self.reg_first else "TBD"
        s = self.reg_second.athlete.get_full_name() if self.reg_second else "TBD"
        return f"R{self.round_index}.{self.match_order}: {f} vs {s}"

    # --- бізнес-методи ---

    def update_score(self, participant, delta=1):
        """Оновлює рахунок учасника (1 або 2)."""
        if participant not in (1, 2):
            raise ValidationError("participant має бути 1 або 2")
        field = "score_first" if participant == 1 else "score_second"
        setattr(self, field, getattr(self, field) + delta)
        if self.status == self.Status.SCHEDULED:
            self.status = self.Status.ONGOING
        self.save(update_fields=[field, "status"])

    def add_warning(self, participant):
        if participant not in (1, 2):
            raise ValidationError("participant має бути 1 або 2")
        field = "warnings_first" if participant == 1 else "warnings_second"
        setattr(self, field, getattr(self, field) + 1)
        self.save(update_fields=[field])

    @transaction.atomic
    def set_winner(self, winner_registration, method=WinMethod.DECISION):
        """Фіксує переможця, завершує матч і просуває його у next_match."""
        if winner_registration not in (self.reg_first, self.reg_second):
            raise ValidationError("Переможцем може бути лише учасник цього поєдинку")

        self.winner = winner_registration
        self.win_method = method
        self.status = self.Status.COMPLETED
        from django.utils import timezone

        self.completed_at = timezone.now()
        self.save(update_fields=["winner", "win_method", "status", "completed_at"])

        self.advance_participant()

    def advance_participant(self):
        """Переносить переможця в наступний матч дерева."""
        if not self.next_match or not self.winner:
            return

        nxt = self.next_match
        # У перший вільний слот (reg_first → reg_second)
        if nxt.reg_first is None:
            nxt.reg_first = self.winner
            nxt.save(update_fields=["reg_first"])
        elif nxt.reg_second is None:
            nxt.reg_second = self.winner
            nxt.save(update_fields=["reg_second"])
        # Якщо обидва слоти зайняті — це означає помилку в структурі дерева
        else:
            raise ValidationError(f"Наступний матч {nxt.id} вже заповнено обома учасниками")


class MatchEvent(models.Model):
    """Append-only лог подій поєдинку (Event Sourcing)."""

    class EventType(models.TextChoices):
        SCORE = "score", "Нарахування балів"
        WARNING = "warning", "Попередження"
        SENSHU = "senshu", "Сенсю"
        FLAGS_DECISION = "flags_decision", "Рішення прапорами (Kata)"
        FINISH = "finish", "Завершення поєдинку"
        START = "start", "Початок поєдинку"
        RESET = "reset", "Скидання стану"

    match = models.ForeignKey(
        Match,
        on_delete=models.CASCADE,
        related_name="events",
        verbose_name="Поєдинок",
    )
    sequence = models.PositiveIntegerField(verbose_name="Порядковий номер події")
    event_type = models.CharField(
        max_length=20,
        choices=EventType.choices,
        verbose_name="Тип події",
    )
    payload = models.JSONField(default=dict, verbose_name="Дані події")
    judge = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="judged_events",
        verbose_name="Суддя",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "match_event"
        verbose_name = "Подія поєдинку"
        verbose_name_plural = "Події поєдинку"
        ordering = ["match", "sequence"]
        constraints = [
            models.UniqueConstraint(fields=["match", "sequence"], name="uq_match_event_sequence")
        ]

    def __str__(self):
        return f"Match {self.match_id} | seq={self.sequence} | {self.event_type}"
