"""
Моделі турнірного рівня: Tournament → Category → Registration.
Повністю відповідають таблицям 2.5–2.7 пояснювальної записки.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class Tournament(models.Model):
    """Турнір — корневий об'єкт ієрархії змагань."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Чернетка"
        REGISTRATION = "registration", "Реєстрація"
        ACTIVE = "active", "Триває"
        COMPLETED = "completed", "Завершено"

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organized_tournaments",
        verbose_name="Організатор",
    )
    title = models.CharField(max_length=255, verbose_name="Назва")
    sport_type = models.CharField(
        max_length=100,
        verbose_name="Вид спорту",
        help_text="Карате, Дзюдо, Тхеквондо, Грепплінг...",
    )
    location = models.CharField(max_length=255, verbose_name="Місце проведення")
    start_date = models.DateTimeField(verbose_name="Початок")
    end_date = models.DateTimeField(verbose_name="Завершення")
    registration_start = models.DateTimeField(
        null=True, blank=True, verbose_name="Початок реєстрації"
    )
    registration_end = models.DateTimeField(null=True, blank=True, verbose_name="Кінець реєстрації")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Завершено о")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT, verbose_name="Статус"
    )
    weigh_in_required = models.BooleanField(
        default=True,
        verbose_name="Потрібне зважування",
        help_text="Якщо вимкнено, учасники автоматично "
        "підтверджуються при реєстрації без зважування",
    )
    # Фінансові налаштування
    online_payment_enabled = models.BooleanField(default=True, verbose_name="Онлайн оплата")
    payment_details = models.TextField(blank=True, verbose_name="Реквізити для оплати")
    base_registration_fee = models.PositiveIntegerField(default=500, verbose_name="Базова вартість")
    ruleset_prices = models.JSONField(default=dict, blank=True, verbose_name="Ціни за рулсети")
    base_team_registration_fee = models.PositiveIntegerField(
        null=True, blank=True, verbose_name="Базова вартість за учасника у командних категоріях"
    )
    ruleset_team_prices = models.JSONField(
        default=dict, blank=True, verbose_name="Ціни для командних категорій за рулсетами"
    )
    commission_payer = models.CharField(
        max_length=20,
        choices=[("buyer", "Покупець"), ("organizer", "Організатор")],
        default="buyer",
        verbose_name="Хто сплачує комісію",
    )
    refund_policy = models.CharField(
        max_length=20,
        choices=[
            ("refundable", "Повернення дозволено"),
            ("non_refundable", "Внески не повертаються (штраф 100%)"),
        ],
        default="refundable",
        verbose_name="Правила повернення внесків",
    )
    platform_fee_status = models.CharField(
        max_length=20,
        choices=[("paid", "Сплачено"), ("unpaid", "Не сплачено")],
        default="paid",
        verbose_name="Статус оплати комісії",
    )
    platform_fee_amount = models.PositiveIntegerField(
        default=0, verbose_name="Сума комісії за офлайн-заявки"
    )
    staff_members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="staff_tournaments",
        verbose_name="Робочий персонал",
    )
    use_check_in = models.BooleanField(
        default=False,
        verbose_name="Відмічати явку",
        help_text="Секретар може відмічати прибуття спортсменів на місці",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "tournament"
        verbose_name = "Турнір"
        verbose_name_plural = "Турніри"
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.title} ({self.start_date.date()})"

    def save(self, *args, **kwargs):
        if self.pk:
            old = Tournament.objects.get(pk=self.pk)
            if old.weigh_in_required and not self.weigh_in_required:
                from apps.tournaments.models import Registration

                Registration.objects.filter(
                    category__tournament=self, status=Registration.Status.PENDING
                ).update(status=Registration.Status.CONFIRMED)
        super().save(*args, **kwargs)

    def clean(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError("Дата завершення не може бути раніше за дату початку")

    # --- методи життєвого циклу ---

    def open_registration(self):
        if self.status != self.Status.DRAFT:
            raise ValidationError("Відкрити реєстрацію можна лише з чернетки")
        self.status = self.Status.REGISTRATION
        self.save(update_fields=["status"])

    def start_tournament(self):
        if self.status != self.Status.REGISTRATION:
            raise ValidationError("Турнір можна розпочати лише після реєстрації")
        self.status = self.Status.ACTIVE
        self.save(update_fields=["status"])

    def complete_tournament(self):
        if self.status != self.Status.ACTIVE:
            raise ValidationError("Завершити можна лише активний турнір")
        self.status = self.Status.COMPLETED
        self.completed_at = timezone.now()

        # 1. Clear staff assignments
        self.staff_members.clear()

        # 2. Clear assigned judges on all tatamis of this tournament
        self.tatamis.update(assigned_judge=None)

        # 3. Calculate platform fee amount for all offline paid registrations (5%)
        from apps.tournaments.models import Registration

        # If refund policy is refundable, transition withdrawn offline-paid
        # registrations to unpaid first
        if self.refund_policy == "refundable":
            Registration.objects.filter(
                category__tournament=self,
                status="withdrawn",
                payment_status="paid",
                payment_method="offline",
            ).update(payment_status="unpaid", offline_refund_status="confirmed")

        offline_regs = Registration.objects.filter(
            category__tournament=self,
            payment_status="paid",
            payment_method="offline",
        ).select_related("category")
        total_offline_debt = 0
        for reg in offline_regs:
            price = reg.category.get_athlete_fee()
            if reg.category.is_team:
                price = price * (reg.category.team_size or 3)
            total_offline_debt += int(price * 0.05)

        self.platform_fee_amount = total_offline_debt
        if total_offline_debt > 0:
            self.platform_fee_status = "unpaid"
        else:
            self.platform_fee_status = "paid"

        # 4. Process deferred batch refunds for withdrawn online-paid registrations
        import uuid
        from collections import defaultdict

        from apps.billing.models import PaymentInvoice, Transaction
        from apps.billing.services import MonobankService
        from apps.billing.views import calculate_registration_fee

        withdrawn_paid_regs = Registration.objects.filter(
            category__tournament=self,
            status="withdrawn",
            payment_status="paid",
            payment_method="online",
        ).select_related("category")

        if self.refund_policy == "refundable" and withdrawn_paid_regs.exists():
            invoice_groups = defaultdict(list)
            for reg in withdrawn_paid_regs:
                invoice = reg.payment_invoices.filter(status=PaymentInvoice.Status.PAID).first()
                if invoice and invoice.invoice_id:
                    invoice_groups[invoice].append(reg)

            for invoice, regs in invoice_groups.items():
                try:
                    total_refund = 0
                    for reg in regs:
                        base_fee = calculate_registration_fee(reg)
                        if self.commission_payer == "buyer":
                            total_refund += base_fee
                        else:
                            total_refund += int(base_fee * 0.95)

                    if total_refund > 0:
                        names_list = []
                        for r in regs:
                            if r.athlete:
                                names_list.append(f"{r.athlete.last_name} {r.athlete.first_name}")
                            elif r.team:
                                names_list.append(r.team.name)
                        names_str = ", ".join(names_list)
                        ref_id = f"REF-{uuid.uuid4().hex[:8]}-{names_str}"[:100]

                        MonobankService.refund_invoice(
                            invoice_id=invoice.invoice_id,
                            amount_uah=total_refund,
                            ext_ref=ref_id,
                        )
                        Transaction.objects.create(
                            invoice=invoice,
                            user=invoice.user,
                            payment_type=PaymentInvoice.PaymentType.REGISTRATIONS,
                            transaction_type=Transaction.Type.REFUND,
                            amount=-total_refund,
                            method=Transaction.Method.ONLINE,
                            reference=ref_id,
                            monobank_receipt_id=invoice.transactions.first().monobank_receipt_id
                            if invoice.transactions.exists()
                            else None,
                            receipt_url=invoice.transactions.first().receipt_url
                            if invoice.transactions.exists()
                            else None,
                        )
                        for reg in regs:
                            reg.payment_status = "unpaid"
                            reg.save(update_fields=["payment_status"])
                except Exception:
                    pass

        self.save(
            update_fields=[
                "status",
                "completed_at",
                "platform_fee_amount",
                "platform_fee_status",
            ]
        )

    def check_and_update_status(self):
        """Перевіряє дати та автоматично оновлює статус турніру, якщо настав час."""
        now = timezone.now()
        updated = False

        # 1. Draft -> Registration (якщо настав час registration_start)
        if self.status == self.Status.DRAFT:
            if self.registration_start and now >= self.registration_start:
                if not self.registration_end or now < self.registration_end:
                    self.status = self.Status.REGISTRATION
                    updated = True

        # 2. Registration -> Active (якщо настав час start_date)
        if self.status == self.Status.REGISTRATION:
            if self.start_date and now >= self.start_date:
                # Перевіряємо кредитний ліміт організатора перед активацією
                from django.db.models import Sum

                total_debt = (
                    Tournament.objects.filter(
                        organizer=self.organizer,
                        status=self.Status.COMPLETED,
                        platform_fee_status="unpaid",
                        platform_fee_amount__gt=0,
                    ).aggregate(total=Sum("platform_fee_amount"))["total"]
                    or 0
                )

                if total_debt <= self.organizer.credit_limit:
                    self.status = self.Status.ACTIVE
                    updated = True

        # 3. Active -> Completed (якщо настав час end_date)
        if self.status == self.Status.ACTIVE:
            if self.end_date and now >= self.end_date:
                try:
                    self.complete_tournament()
                    updated = True
                except Exception:
                    pass

        if updated and self.status != self.Status.COMPLETED:
            self.save(update_fields=["status"])

    @classmethod
    def auto_transition_statuses(cls):
        """Оновлює статуси турнірів на основі поточного часу."""
        now = timezone.now()
        from django.db.models import Sum

        # 1. Draft -> Registration
        drafts = cls.objects.filter(
            status=cls.Status.DRAFT, registration_start__isnull=False, registration_start__lte=now
        )
        for t in drafts:
            if not t.registration_end or now < t.registration_end:
                t.status = cls.Status.REGISTRATION
                t.save(update_fields=["status"])

        # 2. Registration -> Active
        registrations = cls.objects.filter(status=cls.Status.REGISTRATION, start_date__lte=now)
        for t in registrations:
            total_debt = (
                cls.objects.filter(
                    organizer=t.organizer,
                    status=cls.Status.COMPLETED,
                    platform_fee_status="unpaid",
                    platform_fee_amount__gt=0,
                ).aggregate(total=Sum("platform_fee_amount"))["total"]
                or 0
            )

            if total_debt <= t.organizer.credit_limit:
                t.status = cls.Status.ACTIVE
                t.save(update_fields=["status"])

        # 3. Active -> Completed
        actives = cls.objects.filter(status=cls.Status.ACTIVE, end_date__lte=now)
        for t in actives:
            try:
                t.complete_tournament()
            except Exception:
                pass


class Category(models.Model):
    """Вагова / вікова категорія турніру."""

    class AllowedGender(models.TextChoices):
        MALE = "male", "Чоловіча"
        FEMALE = "female", "Жіноча"
        MIXED = "mixed", "Змішана"

    class BracketFormat(models.TextChoices):
        SINGLE_ELIMINATION = "single_elimination", "Олімпійська (на вибування)"
        ROUND_ROBIN = "round_robin", "Кругова"
        SINGLE_ELIM_REPECHAGE = "single_repechage", "Олімпійська сітка з репешажем"
        DOUBLE_ELIMINATION = "double_elimination", "Double Elimination"
        SWISS = "swiss", "Швейцарська"

    class DoubleElimType(models.TextChoices):
        FULL = "full", "Класичний (з Bracket Reset)"
        SHORT = "short", "Спрощений (один фінал)"

    tournament = models.ForeignKey(
        Tournament, on_delete=models.CASCADE, related_name="categories", verbose_name="Турнір"
    )
    name = models.CharField(max_length=100, verbose_name="Назва категорії")
    allowed_gender = models.CharField(
        max_length=10, choices=AllowedGender.choices, verbose_name="Допустима стать"
    )
    min_age = models.PositiveSmallIntegerField(verbose_name="Мінімальний вік")
    max_age = models.PositiveSmallIntegerField(verbose_name="Максимальний вік")
    min_weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Мін. вага (кг)",
    )
    max_weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Макс. вага (кг)",
    )
    allowed_skill_level = models.CharField(
        max_length=50, blank=True, verbose_name="Допустимий рівень майстерності"
    )
    is_team = models.BooleanField(default=False, verbose_name="Групова категорія")
    team_size = models.PositiveSmallIntegerField(
        default=3, verbose_name="Кількість бійців у команді"
    )
    registration_fee = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Спеціальна вартість за учасника",
        help_text="Якщо вказано, перевизначає базову вартість турніру для цієї категорії",
    )

    bracket_format = models.CharField(
        max_length=50,
        choices=BracketFormat.choices,
        default=BracketFormat.SINGLE_ELIMINATION,
        verbose_name="Формат сітки",
    )
    double_elim_type = models.CharField(
        max_length=10,
        choices=DoubleElimType.choices,
        blank=True,
        default="",
        verbose_name="Тип Double Elimination",
    )
    ruleset_key = models.CharField(
        max_length=50,
        default="karate_wkf",
        verbose_name="Ключ рулсету",
    )
    match_duration_seconds = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Тривалість поєдинку (сек)",
        help_text="Перевизначає значення за замовчуванням із рулсету",
    )
    schedule_order = models.PositiveIntegerField(
        default=0,
        verbose_name="Порядок у розкладі",
    )
    two_third_places = models.BooleanField(
        default=True,
        verbose_name="Два третіх місця",
        help_text=(
            "Якщо увімкнено, обидва спортсмени, які програли в півфіналах, отримують 3-є місце."
        ),
    )
    judges_count = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name="Кількість суддів для Ката",
    )

    class Meta:
        db_table = "category"
        verbose_name = "Категорія"
        verbose_name_plural = "Категорії"
        ordering = ["tournament", "schedule_order", "name"]

    def __str__(self):
        return f"{self.name} — {self.tournament.title}"

    def clean(self):
        if self.min_age > self.max_age:
            raise ValidationError("Мін. вік не може бути більшим за макс.")
        if self.min_weight is not None and self.max_weight is not None:
            if self.min_weight >= self.max_weight:
                raise ValidationError("Мін. вага повинна бути меншою за макс.")
        if self.bracket_format == self.BracketFormat.SINGLE_ELIM_REPECHAGE:
            self.two_third_places = True

    def validate_athlete_eligibility(self, athlete, reference_date=None):
        """Перевіряє, чи підходить спортсмен під критерії категорії.

        Повертає (is_eligible: bool, reasons: list[str]).
        """
        reasons = []

        # Стать
        if self.allowed_gender != self.AllowedGender.MIXED:
            if athlete.gender != self.allowed_gender:
                reasons.append(
                    f"Стать не відповідає категорії ({self.get_allowed_gender_display()})"
                )

        # Вік
        age = athlete.calculate_current_age(reference_date)
        if not (self.min_age <= age <= self.max_age):
            reasons.append(f"Вік {age} поза діапазоном [{self.min_age}; {self.max_age}]")

        # Вага (базова, фактична перевіряється при зважуванні)
        # Перевірка ваги лише якщо категорія має вагові обмеження
        if self.min_weight is not None and self.max_weight is not None:
            if not (self.min_weight <= athlete.base_weight <= self.max_weight):
                reasons.append(
                    f"Базова вага {athlete.base_weight} кг поза діапазоном "
                    f"[{self.min_weight}; {self.max_weight}]"
                )
        elif self.min_weight is not None:
            if athlete.base_weight < self.min_weight:
                reasons.append(
                    f"Базова вага {athlete.base_weight} кг менша за "
                    f"мінімальну ({self.min_weight} кг)"
                )
        elif self.max_weight is not None:
            if athlete.base_weight > self.max_weight:
                reasons.append(
                    f"Базова вага {athlete.base_weight} кг більша за "
                    f"максимальну ({self.max_weight} кг)"
                )

        return (len(reasons) == 0, reasons)

    def get_athlete_fee(self):
        """Повертає вартість участі за одного спортсмена."""
        if self.registration_fee is not None:
            return self.registration_fee
        if self.is_team:
            if self.ruleset_key in self.tournament.ruleset_team_prices:
                return self.tournament.ruleset_team_prices[self.ruleset_key]
            if self.tournament.base_team_registration_fee is not None:
                return self.tournament.base_team_registration_fee
        return self.tournament.ruleset_prices.get(
            self.ruleset_key, self.tournament.base_registration_fee
        )


class Registration(models.Model):
    """Заявка спортсмена на участь у категорії."""

    class Status(models.TextChoices):
        PENDING = "pending", "Очікує підтвердження"
        CONFIRMED = "confirmed", "Підтверджено"
        REJECTED = "rejected", "Відхилено"
        WITHDRAWN = "withdrawn", "Знято"

    athlete = models.ForeignKey(
        "athletes.Athlete",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="registrations",
        verbose_name="Спортсмен",
    )
    team = models.ForeignKey(
        "athletes.Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registrations",
        verbose_name="Команда",
    )
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="registrations", verbose_name="Категорія"
    )
    seed_number = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Номер посіву",
        help_text="Встановлюється алгоритмом жеребкування",
    )
    recorded_weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Вага при зважуванні (кг)",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="Статус"
    )
    payment_status = models.CharField(
        max_length=20,
        choices=[("unpaid", "Не сплачено"), ("paid", "Сплачено")],
        default="unpaid",
        verbose_name="Статус оплати",
    )
    payment_method = models.CharField(
        max_length=20,
        choices=[("online", "Онлайн"), ("offline", "Офлайн (Готівка)")],
        default="offline",
        verbose_name="Спосіб оплати",
    )
    offline_refund_status = models.CharField(
        max_length=20,
        choices=[
            ("none", "Немає"),
            ("pending", "Очікує підтвердження"),
            ("confirmed", "Підтверджено отримання"),
        ],
        default="none",
        verbose_name="Статус повернення готівки",
    )
    place = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name="Місце в категорії",
        help_text="Отримане призове місце (1, 2, 3, 5 тощо) після закінчення змагань у категорії",
    )
    checked_in = models.BooleanField(
        default=False,
        verbose_name="Явка підтверджена",
        help_text="Спортсмен фізично прибув на місце проведення",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "registration"
        verbose_name = "Реєстрація"
        verbose_name_plural = "Реєстрації"
        constraints = [
            models.UniqueConstraint(
                fields=["athlete", "category"],
                condition=models.Q(athlete__isnull=False),
                name="uq_registration_athlete_category",
            ),
            models.UniqueConstraint(
                fields=["team", "category"],
                condition=models.Q(team__isnull=False),
                name="uq_registration_team_category",
            ),
        ]
        indexes = [
            models.Index(fields=["category", "status"], name="idx_reg_category_status"),
        ]

    def __str__(self):
        participant = self.athlete if self.athlete else self.team
        return f"{participant} → {self.category.name}"

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        old_status = None
        if not is_new:
            try:
                old_status = Registration.objects.get(pk=self.pk).status
            except Registration.DoesNotExist:
                pass

        super().save(*args, **kwargs)

        if old_status != self.Status.WITHDRAWN and self.status == self.Status.WITHDRAWN:
            from apps.matches.models import Match

            matches = Match.objects.filter(
                category=self.category, status__in=[Match.Status.SCHEDULED, Match.Status.ONGOING]
            ).filter(models.Q(reg_first=self) | models.Q(reg_second=self))
            for match in matches:
                match.handle_auto_walkover()

    def _validate_category_participant(self):
        if self.category.is_team:
            if not self.team:
                raise ValidationError("Для групової категорії необхідно вказати команду.")
            if self.athlete:
                raise ValidationError(
                    "Для групової категорії не можна вказувати окремого спортсмена."
                )
        else:
            if not self.athlete:
                raise ValidationError("Для індивідуальної категорії необхідно вказати спортсмена.")
            if self.team:
                raise ValidationError("Для індивідуальної категорії не можна вказувати команду.")

    def clean(self):
        super().clean()
        if self.category:
            self._validate_category_participant()

    def confirm_weigh_in(self, weight):
        """Підтверджує зважування та переводить заявку у статус CONFIRMED."""
        category = self.category
        if category.min_weight is not None and weight < float(category.min_weight):
            raise ValidationError(
                f"Вага {weight} кг менша за мінімально допустиму для цієї "
                f"категорії ({category.min_weight} кг)."
            )
        if category.max_weight is not None and weight > float(category.max_weight):
            raise ValidationError(
                f"Вага {weight} кг більша за максимально допустиму для цієї "
                f"категорії ({category.max_weight} кг)."
            )

        self.recorded_weight = weight
        self.status = self.Status.CONFIRMED
        self.save(update_fields=["recorded_weight", "status"])

        # Log weight in weight history
        if self.athlete:
            from apps.athletes.models import AthleteWeightLog

            AthleteWeightLog.objects.create(
                athlete=self.athlete,
                weight=weight,
                notes=f"Офіційне зважування: {category.tournament.title}",
            )

    def assign_seed(self, number):
        self.seed_number = number
        self.save(update_fields=["seed_number"])
