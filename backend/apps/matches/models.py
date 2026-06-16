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
        DRAW = "draw", "Нічия"

    class Senshu(models.TextChoices):
        NONE = "none", "None"
        AKA = "aka", "Aka"
        AO = "ao", "Ao"

    class TimerStatus(models.TextChoices):
        NOT_STARTED = "not_started", "Not started"
        RUNNING = "running", "Running"
        PAUSED = "paused", "Paused"
        FINISHED = "finished", "Finished"

    REG_MODEL = "tournaments.Registration"

    category = models.ForeignKey(
        "tournaments.Category",
        on_delete=models.CASCADE,
        related_name="matches",
        verbose_name="Категорія",
    )
    parent_team_match = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="team_bouts",
        verbose_name="Командна зустріч",
    )
    athlete_first = models.ForeignKey(
        "athletes.Athlete",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matches_as_first_athlete",
        verbose_name="Атлет Aka",
    )
    athlete_second = models.ForeignKey(
        "athletes.Athlete",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matches_as_second_athlete",
        verbose_name="Атлет Ao",
    )
    bout_index = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name="Номер бою у зустрічі",
    )
    reg_first = models.ForeignKey(
        REG_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matches_as_first",
        verbose_name="Учасник 1",
    )
    reg_second = models.ForeignKey(
        REG_MODEL,
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
    tatami = models.ForeignKey(
        "tatamis.Tatami",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tatami_matches",
        verbose_name="Татамі",
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
    timer_status = models.CharField(
        max_length=15,
        choices=TimerStatus.choices,
        default=TimerStatus.NOT_STARTED,
        verbose_name="Статус таймера",
    )
    timer_started_at = models.DateTimeField(null=True, blank=True, verbose_name="Таймер запущено о")
    timer_elapsed_ms = models.PositiveIntegerField(default=0, verbose_name="Накопичено мс")
    timer_duration_ms = models.PositiveIntegerField(default=180000, verbose_name="Тривалість мс")
    show_timer = models.BooleanField(default=False, verbose_name="Показувати таймер")

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
        f = self._get_competitor_name(self.athlete_first, self.reg_first)
        s = self._get_competitor_name(self.athlete_second, self.reg_second)
        suffix = f" (Бій {self.bout_index})" if self.parent_team_match else ""
        return f"R{self.round_index}.{self.match_order}{suffix}: {f} vs {s}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self._create_team_bouts_if_needed()

    def _get_ruleset_team_bouts_supported(self):
        from apps.rulesets.registry import get_ruleset

        try:
            ruleset = get_ruleset(self.category.ruleset_key)
            return ruleset.is_team_bouts_supported()
        except KeyError:
            return False

    def _get_team_athletes(self, reg):
        if reg and reg.team:
            return list(reg.team.athletes.all().order_by("id"))
        return []

    def _create_single_team_bout(self, idx, ath_first, ath_second):
        Match.objects.create(
            category=self.category,
            parent_team_match=self,
            round_index=self.round_index,
            match_order=self.match_order,
            bout_index=idx,
            reg_first=self.reg_first,
            reg_second=self.reg_second,
            athlete_first=ath_first,
            athlete_second=ath_second,
            timer_duration_ms=self.timer_duration_ms,
            status=self.Status.SCHEDULED,
        )

    def _get_athlete_at_index(self, athletes, index):
        if index < len(athletes):
            return athletes[index]
        return None

    def _create_team_bouts_if_needed(self):
        if (
            self.category.is_team
            and not self.parent_team_match
            and self.reg_first
            and self.reg_second
        ):
            if self._get_ruleset_team_bouts_supported() and not self.team_bouts.exists():
                team_size = getattr(self.category, "team_size", 3)
                athletes_first = self._get_team_athletes(self.reg_first)
                athletes_second = self._get_team_athletes(self.reg_second)

                for idx in range(1, team_size + 1):
                    ath_first = self._get_athlete_at_index(athletes_first, idx - 1)
                    ath_second = self._get_athlete_at_index(athletes_second, idx - 1)
                    self._create_single_team_bout(idx, ath_first, ath_second)

    def _get_competitor_name(self, athlete, reg):
        if athlete:
            return athlete.get_full_name()
        if reg and reg.athlete:
            return reg.athlete.get_full_name()
        if reg and reg.team:
            return reg.team.name
        return "TBD"

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

        update_fields = ["winner", "win_method", "status", "completed_at"]
        if self.category.is_team and not self.parent_team_match:
            update_fields.extend(["score_first", "score_second"])
        self.save(update_fields=update_fields)

        # Якщо це суб-бой командного матчу:
        if self.parent_team_match:
            self._handle_parent_team_match_update()
        else:
            self.advance_participant()

        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(self)

    def _handle_parent_team_match_update(self):
        parent = self.parent_team_match
        parent.refresh_from_db()
        from apps.rulesets.registry import get_ruleset

        try:
            # Оновлюємо рахунок батьківського матчу (кількість виграних боїв)
            completed_bouts = parent.team_bouts.filter(status=self.Status.COMPLETED)
            parent.score_first = completed_bouts.filter(winner_id=parent.reg_first_id).count()
            parent.score_second = completed_bouts.filter(winner_id=parent.reg_second_id).count()

            ruleset = get_ruleset(parent.category.ruleset_key)
            is_finished, parent_winner_id, parent_win_method = ruleset.determine_team_winner(parent)
            if is_finished and parent_winner_id:
                parent_winner_reg = (
                    parent.reg_first
                    if parent.reg_first_id == parent_winner_id
                    else parent.reg_second
                )
                parent.set_winner(parent_winner_reg, parent_win_method)
            else:
                has_active = parent.team_bouts.filter(
                    status__in=[self.Status.ONGOING, self.Status.COMPLETED]
                ).exists()
                parent.status = self.Status.ONGOING if has_active else self.Status.SCHEDULED
                parent.save(update_fields=["score_first", "score_second", "status"])
        except Exception as e:
            print(f"Error determining team winner: {e}")

        # Повертаємо поточний матч татамі назад на командну зустріч
        if self.tatami and self.tatami.current_match_id == self.id:
            self.tatami.current_match = parent
            self.tatami.save(update_fields=["current_match"])
            from apps.common.broadcast import broadcast_tatami_state

            broadcast_tatami_state(self.tatami)

        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(self)

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

        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(nxt)


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
        TIMER_START = "timer_start", "Старт таймера"
        TIMER_PAUSE = "timer_pause", "Пауза таймера"
        TIMER_RESUME = "timer_resume", "Продовження таймера"
        TIMER_RESET = "timer_reset", "Скидання таймера"
        TIMER_SET_DUR = "timer_set_dur", "Зміна тривалості"
        TIMER_TOGGLE = "timer_toggle", "Відображення таймера"
        JUDGES_COUNT_CHANGE = "judges_count_change", "Зміна кількості суддів"

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
