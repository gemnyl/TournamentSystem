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
    is_bracket_reset = models.BooleanField(
        default=False, verbose_name="Супер-фінал (Bracket Reset)"
    )
    match_state = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Стан поєдинку",
    )

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

            # Обробка додаткових форматів після просування переможця/програвшого:
            # 1. Репешаж:
            if self.category.bracket_format == "single_repechage":
                if self.next_match and self.next_match.next_match_id is None:
                    final_match = self.next_match
                    semis = Match.objects.filter(category=self.category, next_match=final_match)
                    if all(semi.status == Match.Status.COMPLETED for semi in semis):
                        from apps.brackets.services import RepechageService

                        RepechageService.generate_for_category(self.category)

            # 2. Гранд-Фінал Double Elimination (round_index == 200):
            # Спрацьовує ТІЛЬКИ для основного Grand Final (r=200), НЕ для Bracket Reset (r=201).
            if self.category.bracket_format == "double_elimination" and self.round_index == 200:
                if self.category.double_elim_type == "full":
                    # Визначаємо переможця WB: той, чий вихідний матч має loser_next_match
                    # (тобто він прийшов з Winners Bracket, де є відправка програвших у LB).
                    # LB-переможець приходить з матчу з round_index >= 100,
                    # де loser_next_match = NULL.
                    wb_finalist = None
                    source_matches = Match.objects.filter(
                        category=self.category,
                        next_match=self,
                    ).select_related("reg_first", "reg_second")
                    for src in source_matches:
                        if src.loser_next_match_id is not None:
                            # Це матч Winners Bracket → його переможець є WB-фіналістом
                            wb_finalist = src.winner
                            break

                    # Bracket Reset потрібен лише якщо LB-переможець виграв Grand Final
                    lb_winner_won = (wb_finalist is not None) and (self.winner != wb_finalist)
                    br_already_exists = Match.objects.filter(
                        category=self.category, round_index=201
                    ).exists()

                    if lb_winner_won and not br_already_exists:
                        super_final = Match.objects.create(
                            category=self.category,
                            reg_first=wb_finalist,
                            reg_second=self.winner,
                            round_index=201,
                            match_order=1,
                            is_bracket_reset=True,
                            tatami=self.tatami,
                            timer_duration_ms=self.timer_duration_ms,
                            status=self.Status.SCHEDULED,
                        )
                        self.redirect_to_match_id = super_final.id
                        if self.tatami:
                            self.tatami.current_match = super_final
                            self.tatami.save(update_fields=["current_match"])
                            from apps.common.broadcast import broadcast_tatami_state

                            transaction.on_commit(lambda: broadcast_tatami_state(self.tatami))
                        from apps.common.broadcast import broadcast_match_update

                        transaction.on_commit(lambda: broadcast_match_update(super_final))

            # 3. Обробка BYE:
            from apps.brackets.services import BracketGenerator

            generator = BracketGenerator(self.category)
            generator._process_byes_for_category(self.category)

        from apps.common.broadcast import broadcast_match_update

        transaction.on_commit(lambda: broadcast_match_update(self))

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

        pass

    def _handle_tatami_auto_advance(self):
        """
        Автоматичний перехід до наступного бою в черзі татамі.
        Викликається, коли поточний активний бій на татамі завершується.

        Шукає наступний готовий бій серед ВСІХ матчів категорій, які вже
        асоційовані з цим татамі (не лише тих, де match.tatami = цей татамі).
        Це запобігає пропуску матчів, у яких ще не встановлено FK tatami.
        """
        from apps.common.broadcast import broadcast_tatami_state
        from apps.tatamis.models import Tatami

        parent = self.parent_team_match
        if parent:
            self.tatami.current_match = parent
            self.tatami.save(update_fields=["current_match"])
        else:
            from django.db.models import Case, IntegerField, Value, When

            # Збираємо усі категорії, що вже мають хоча б один матч на цьому татамі
            tatami_category_ids = list(
                Match.objects.filter(tatami=self.tatami)
                .values_list("category_id", flat=True)
                .distinct()
            )

            # Шукаємо наступний готовий бій серед ВСІХ матчів цих категорій
            next_match = (
                Match.objects.filter(
                    category_id__in=tatami_category_ids,
                    status=self.Status.SCHEDULED,
                    parent_team_match__isnull=True,
                    reg_first__isnull=False,
                    reg_second__isnull=False,
                )
                .exclude(id=self.id)
                .annotate(
                    repechage_priority=Case(
                        When(next_match__isnull=True, round_index__lt=300, then=Value(2)),
                        When(round_index__gte=300, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    )
                )
                .order_by(
                    "round_index", "match_order", "category__schedule_order", "repechage_priority"
                )
                .first()
            )

            if next_match:
                # Звільняємо цей наступний матч з інших татамі, якщо він там був призначений
                other_tatamis = Tatami.objects.filter(current_match=next_match).exclude(
                    id=self.tatami.id
                )
                for ot in other_tatamis:
                    ot.current_match = None
                    ot.save(update_fields=["current_match"])
                    transaction.on_commit(
                        lambda ot_instance=ot: broadcast_tatami_state(ot_instance)
                    )

                # Встановлюємо FK tatami на наступний матч та активуємо його
                next_match.tatami = self.tatami
                next_match.save(update_fields=["tatami"])

                self.tatami.current_match = next_match
                self.tatami.active_results_category = None
                self.tatami.save(update_fields=["current_match", "active_results_category"])
            else:
                self.tatami.current_match = None
                self.tatami.save(update_fields=["current_match"])

        # Надсилаємо бродкаст стану татамі тільки після успішного комміту транзакції
        transaction.on_commit(lambda: broadcast_tatami_state(self.tatami))

    def advance_participant(self):
        """Переносить переможця в наступний матч дерева."""
        if self.next_match and self.winner:
            nxt = self.next_match
            nxt.refresh_from_db()
            if nxt.reg_first_id == self.winner_id or nxt.reg_second_id == self.winner_id:
                if nxt.reg_first_id is not None and nxt.reg_second_id is not None:
                    raise ValidationError(f"Наступний матч {nxt.id} вже заповнено обома учасниками")
                pass
            elif nxt.reg_first is None:
                nxt.reg_first = self.winner
                nxt.save(update_fields=["reg_first"])
            elif nxt.reg_second is None:
                nxt.reg_second = self.winner
                nxt.save(update_fields=["reg_second"])
            # Якщо обидва слоти зайняті — це означає помилку в структурі дерева
            else:
                raise ValidationError(f"Наступний матч {nxt.id} вже заповнено обома учасниками")

            from apps.common.broadcast import broadcast_match_update

            transaction.on_commit(lambda: broadcast_match_update(nxt))

            # Автоматичне вирішення неявки суперника, якщо він знятий з турніру
            nxt.refresh_from_db()
            nxt.handle_auto_walkover()

        # Логіка просування того, хто програв (для Double Elimination)
        if self.loser_next_match:
            loser = self.reg_second if self.winner == self.reg_first else self.reg_first
            if loser:
                nxt_loser = self.loser_next_match
                nxt_loser.refresh_from_db()
                if nxt_loser.reg_first_id == loser.id or nxt_loser.reg_second_id == loser.id:
                    if nxt_loser.reg_first_id is not None and nxt_loser.reg_second_id is not None:
                        raise ValidationError(
                            f"Матч нижньої сітки {nxt_loser.id} вже повністю заповнений."
                        )
                    pass
                elif nxt_loser.reg_first is None:
                    nxt_loser.reg_first = loser
                    nxt_loser.save(update_fields=["reg_first"])
                elif nxt_loser.reg_second is None:
                    nxt_loser.reg_second = loser
                    nxt_loser.save(update_fields=["reg_second"])
                else:
                    raise ValidationError(
                        f"Матч нижньої сітки {nxt_loser.id} вже повністю заповнений."
                    )

                from apps.common.broadcast import broadcast_match_update

                transaction.on_commit(lambda: broadcast_match_update(nxt_loser))

                # Автоматичне вирішення неявки суперника для нижньої сітки
                nxt_loser.refresh_from_db()
                nxt_loser.handle_auto_walkover()

    def handle_auto_walkover(self):
        """
        Перевіряє, чи має матч обох учасників і чи є один з них знятим (withdrawn).
        Якщо так, автоматично призначає технічну перемогу (walkover) опоненту.
        """
        if self.status == self.Status.COMPLETED:
            return

        if self.reg_first_id and self.reg_second_id:
            from apps.tournaments.models import Registration

            reg_first = Registration.objects.get(id=self.reg_first_id)
            reg_second = Registration.objects.get(id=self.reg_second_id)

            first_withdrawn = reg_first.status == Registration.Status.WITHDRAWN
            second_withdrawn = reg_second.status == Registration.Status.WITHDRAWN

            if first_withdrawn and second_withdrawn:
                self.status = self.Status.COMPLETED
                self.win_method = self.WinMethod.WALKOVER
                from django.utils import timezone as django_timezone

                self.completed_at = django_timezone.now()
                self.save(update_fields=["status", "win_method", "completed_at"])
            elif first_withdrawn:
                self.set_winner(reg_second, method=self.WinMethod.WALKOVER)
            elif second_withdrawn:
                self.set_winner(reg_first, method=self.WinMethod.WALKOVER)


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
        RULESET_EVENT = "ruleset_event", "Подія правил"

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
