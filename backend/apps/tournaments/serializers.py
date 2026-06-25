"""
Серіалайзери турнірного рівня: Tournament → Category → Registration.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.athletes.models import Athlete, Team
from apps.athletes.serializers import AthleteSerializer, TeamSerializer
from apps.tournaments.models import Category, Registration, Tournament

User = get_user_model()


class CategorySerializer(serializers.ModelSerializer):
    """Категорія (вагова / вікова) турніру."""

    bracket_format_display = serializers.CharField(
        source="get_bracket_format_display", read_only=True
    )
    allowed_gender_display = serializers.CharField(
        source="get_allowed_gender_display", read_only=True
    )
    status = serializers.CharField(source="tournament.status", read_only=True)
    confirmed_registrations_count = serializers.SerializerMethodField()
    has_bracket = serializers.SerializerMethodField()
    results_finalized = serializers.SerializerMethodField()
    athlete_fee = serializers.IntegerField(source="get_athlete_fee", read_only=True)

    class Meta:
        model = Category
        fields = [
            "id",
            "tournament",
            "name",
            "allowed_gender",
            "allowed_gender_display",
            "min_age",
            "max_age",
            "min_weight",
            "max_weight",
            "allowed_skill_level",
            "ruleset_key",
            "match_duration_seconds",
            "bracket_format",
            "bracket_format_display",
            "double_elim_type",
            "confirmed_registrations_count",
            "has_bracket",
            "status",
            "schedule_order",
            "two_third_places",
            "results_finalized",
            "judges_count",
            "is_team",
            "team_size",
            "registration_fee",
            "athlete_fee",
        ]

    def get_confirmed_registrations_count(self, obj):
        return obj.registrations.filter(status=Registration.Status.CONFIRMED).count()

    def get_has_bracket(self, obj):
        return obj.matches.exists()

    def get_results_finalized(self, obj):
        return obj.registrations.filter(place__isnull=False).exists()


class TournamentSerializer(serializers.ModelSerializer):
    """Список турнірів (без вкладених категорій)."""

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    organizer_name = serializers.CharField(source="organizer.get_full_name", read_only=True)
    staff_members = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False,
    )
    chief_judge = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role="judge"),
        required=False,
        allow_null=True,
    )
    chief_judge_name = serializers.CharField(source="chief_judge.get_full_name", read_only=True)
    judges = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.filter(role="judge"),
        required=False,
    )

    class Meta:
        model = Tournament
        fields = [
            "id",
            "title",
            "description",
            "sport_type",
            "location",
            "start_date",
            "end_date",
            "registration_start",
            "registration_end",
            "completed_at",
            "status",
            "status_display",
            "organizer",
            "organizer_name",
            "chief_judge",
            "chief_judge_name",
            "judges",
            "weigh_in_required",
            "online_payment_enabled",
            "payment_details",
            "base_registration_fee",
            "ruleset_prices",
            "base_team_registration_fee",
            "ruleset_team_prices",
            "commission_payer",
            "platform_fee_status",
            "platform_fee_amount",
            "staff_members",
            "use_check_in",
            "refund_policy",
            "created_at",
        ]
        read_only_fields = [
            "organizer",
            "created_at",
            "status",
            "completed_at",
            "platform_fee_status",
            "platform_fee_amount",
        ]

    def validate(self, attrs):
        # Перевірка, що Головний суддя є у списку суддів турніру
        chief_judge = attrs.get("chief_judge", getattr(self.instance, "chief_judge", None))
        judges = attrs.get("judges", None)
        if judges is not None:
            judge_ids = {getattr(j, "id", j) for j in judges}
        else:
            judge_ids = {j.id for j in self.instance.judges.all()} if self.instance else set()

        if chief_judge:
            cj_id = getattr(chief_judge, "id", chief_judge)
            if cj_id not in judge_ids:
                raise serializers.ValidationError(
                    {"chief_judge": "Головний суддя має бути обраний зі списку суддів турніру."}
                )

        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            # Якщо користувач є головним суддею, але не організатором/адміном
            if self.instance and (
                self.instance.chief_judge == request.user
                and self.instance.organizer != request.user
                and request.user.role != "admin"
            ):
                # Перевіримо, чи намагається він змінити інші поля крім description
                allowed_fields = {"description"}
                for field in attrs.keys():
                    if field not in allowed_fields:
                        raise serializers.ValidationError(
                            f"Головний суддя не має права змінювати поле '{field}'."
                        )

            request.user.refresh_from_db()
            from django.db.models import Sum

            total_debt = (
                Tournament.objects.filter(
                    organizer=request.user,
                    status=Tournament.Status.COMPLETED,
                    platform_fee_status="unpaid",
                    platform_fee_amount__gt=0,
                ).aggregate(total=Sum("platform_fee_amount"))["total"]
                or 0
            )

            # Блокуємо при створенні нового або при спробі перевести існуючий з draft
            new_status = attrs.get("status")
            is_activating = False
            if (
                self.instance
                and self.instance.status == Tournament.Status.DRAFT
                and new_status in (Tournament.Status.REGISTRATION, Tournament.Status.ACTIVE)
            ):
                is_activating = True

            if total_debt > request.user.credit_limit:
                if self.instance is None or is_activating:
                    raise serializers.ValidationError(
                        f"Неможливо створити турнір або відкрити реєстрацію. Ваш борг за комісію "
                        f"({total_debt} UAH) перевищує встановлений кредитний ліміт "
                        f"({request.user.credit_limit} UAH)."
                    )
        return attrs


class TournamentDetailSerializer(TournamentSerializer):
    """Деталі турніру зі вкладеними категоріями."""

    categories = CategorySerializer(many=True, read_only=True)

    class Meta(TournamentSerializer.Meta):
        fields = TournamentSerializer.Meta.fields + ["categories"]


class RegistrationSerializer(serializers.ModelSerializer):
    """Заявка спортсмена на участь у категорії."""

    athlete = AthleteSerializer(read_only=True)
    athlete_id = serializers.PrimaryKeyRelatedField(
        source="athlete",
        queryset=Athlete.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    team = TeamSerializer(read_only=True)
    team_id = serializers.PrimaryKeyRelatedField(
        source="team",
        queryset=Team.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    tournament_id = serializers.IntegerField(source="category.tournament.id", read_only=True)
    tournament_title = serializers.CharField(source="category.tournament.title", read_only=True)
    fee = serializers.SerializerMethodField()
    commission_payer = serializers.CharField(
        source="category.tournament.commission_payer", read_only=True
    )
    coach_name_short = serializers.SerializerMethodField()
    online_payment_enabled = serializers.BooleanField(
        source="category.tournament.online_payment_enabled", read_only=True
    )
    payment_details = serializers.CharField(
        source="category.tournament.payment_details", read_only=True
    )
    refund_policy = serializers.CharField(
        source="category.tournament.refund_policy", read_only=True
    )
    qr_token = serializers.SerializerMethodField()
    tournament_status = serializers.CharField(source="category.tournament.status", read_only=True)
    payment_invoice = serializers.SerializerMethodField()

    class Meta:
        model = Registration
        fields = [
            "id",
            "athlete",
            "athlete_id",
            "team",
            "team_id",
            "category",
            "category_name",
            "tournament_id",
            "tournament_title",
            "tournament_status",
            "fee",
            "commission_payer",
            "coach_name_short",
            "online_payment_enabled",
            "payment_details",
            "refund_policy",
            "seed_number",
            "recorded_weight",
            "status",
            "status_display",
            "payment_status",
            "payment_method",
            "offline_refund_status",
            "place",
            "checked_in",
            "created_at",
            "qr_token",
            "payment_invoice",
        ]
        read_only_fields = ["seed_number", "recorded_weight", "place", "created_at"]

    def get_qr_token(self, obj):
        from django.core import signing

        signer = signing.Signer(salt="qr-verification")
        return signer.sign(f"reg:{obj.id}")

    def get_payment_invoice(self, obj):
        if (
            hasattr(obj, "_prefetched_objects_cache")
            and "payment_invoices" in obj._prefetched_objects_cache
        ):
            invoices = [inv for inv in obj.payment_invoices.all() if inv.status == "paid"]
            invoice = invoices[0] if invoices else None
        else:
            invoice = obj.payment_invoices.filter(status="paid").first()

        if invoice:
            return {
                "id": invoice.id,
                "invoice_id": invoice.invoice_id,
                "amount": invoice.amount,
                "status": invoice.status,
                "payment_url": invoice.payment_url,
                "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
                "registration_details": [
                    {
                        "id": r.id,
                        "athlete_name": f"{r.athlete.last_name} {r.athlete.first_name}"
                        if r.athlete
                        else (r.team.name if r.team else ""),
                        "category_name": r.category.name if r.category else "",
                    }
                    for r in invoice.registrations.all()
                ],
            }
        return None

    def get_fee(self, obj):
        price = obj.category.get_athlete_fee()
        if obj.category.is_team:
            return price * (obj.category.team_size or 3)
        return price

    def get_coach_name_short(self, obj):
        coach = None
        if obj.athlete and obj.athlete.coach:
            coach = obj.athlete.coach
        elif obj.team and obj.team.coach:
            coach = obj.team.coach

        if not coach:
            return "—"

        last_name = coach.last_name or ""
        first_name = coach.first_name or ""
        patronymic = getattr(coach, "patronymic", "") or ""

        initials = ""
        if first_name:
            initials += f" {first_name[0]}."
        if patronymic:
            initials += f" {patronymic[0]}."

        return f"{last_name}{initials}".strip() or coach.email

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Remove automatic UniqueTogetherValidators because athlete_id and team_id
        # are mutually exclusive and nullable, which causes DRF's default validator
        # to make them required.
        self.validators = [
            v for v in self.validators if not isinstance(v, serializers.UniqueTogetherValidator)
        ]

    def _validate_bracket_lock(self, category):
        if category.matches.exists():
            raise serializers.ValidationError(
                "Категорія заблокована: сітка змагань уже сформована."
            )

    def _validate_tournament_status(self, category, athlete, team):
        tournament = category.tournament
        if tournament.status != tournament.Status.REGISTRATION:
            raise serializers.ValidationError(
                "Реєстрація можлива лише тоді, коли турнір знаходиться у статусі 'Реєстрація'."
            )

        from django.utils import timezone

        now = timezone.now()
        if tournament.registration_start and now < tournament.registration_start:
            raise serializers.ValidationError("Реєстрація на цей турнір ще не розпочалася.")
        if tournament.registration_end and now > tournament.registration_end:
            raise serializers.ValidationError("Реєстрація на цей турнір вже завершилася.")

        # Uniqueness checks (since we removed UniqueTogetherValidators)
        if athlete and Registration.objects.filter(athlete=athlete, category=category).exists():
            raise serializers.ValidationError("Спортсмен уже зареєстрований у цій категорії.")
        if team and Registration.objects.filter(team=team, category=category).exists():
            raise serializers.ValidationError("Команда уже зареєстрована у цій категорії.")

    def _validate_individual_vs_team(self, category, athlete, team, is_create):
        if category.is_team:
            if not team and is_create:
                raise serializers.ValidationError(
                    "Для групової категорії необхідно вказати команду."
                )
            if athlete:
                raise serializers.ValidationError(
                    "Для групової категорії не можна вказувати окремого спортсмена."
                )
        else:
            if not athlete and is_create:
                raise serializers.ValidationError(
                    "Для індивідуальної категорії необхідно вказати спортсмена."
                )
            if team:
                raise serializers.ValidationError(
                    "Для індивідуальної категорії не можна вказувати команду."
                )

    def _validate_coach_ownership(self, athlete, team):
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            if request.user.role == "coach":
                if athlete and athlete.coach != request.user:
                    raise serializers.ValidationError(
                        "Ви можете реєструвати лише власних спортсменів."
                    )
                if team and team.coach != request.user:
                    raise serializers.ValidationError("Ви можете реєструвати лише власні команди.")

    def _validate_individual_athlete_audit(self, category, athlete, tournament):
        if athlete:
            is_eligible, reasons = category.validate_athlete_eligibility(
                athlete, tournament.start_date
            )
            if not is_eligible:
                raise serializers.ValidationError(
                    f"Спортсмен не підходить до цієї категорії: {', '.join(reasons)}"
                )
            if category.allowed_skill_level and category.allowed_skill_level.strip():
                if (
                    not athlete.skill_level
                    or athlete.skill_level.strip().lower()
                    != category.allowed_skill_level.strip().lower()
                ):
                    raise serializers.ValidationError(
                        f"Рівень майстерності '{athlete.skill_level}' не "
                        + f"відповідає вимогам категорії ({category.allowed_skill_level})."
                    )

    def _validate_team_athletes_audit(self, category, team, tournament):
        if team:
            for tm_athlete in team.athletes.all():
                is_eligible, reasons = category.validate_athlete_eligibility(
                    tm_athlete, tournament.start_date
                )
                if not is_eligible:
                    raise serializers.ValidationError(
                        f"Спортсмен команди {tm_athlete.get_full_name()} "
                        f"не підходить до цієї категорії: {', '.join(reasons)}"
                    )
                if category.allowed_skill_level and category.allowed_skill_level.strip():
                    if (
                        not tm_athlete.skill_level
                        or tm_athlete.skill_level.strip().lower()
                        != category.allowed_skill_level.strip().lower()
                    ):
                        raise serializers.ValidationError(
                            f"Рівень майстерності '{tm_athlete.skill_level}' у "
                            + f"спортсмена {tm_athlete.get_full_name()} не "
                            + f"відповідає вимогам категорії ({category.allowed_skill_level})."
                        )

    def _validate_category_audit(self, category, athlete, team):
        tournament = category.tournament
        if not category.is_team:
            self._validate_individual_athlete_audit(category, athlete, tournament)
        else:
            self._validate_team_athletes_audit(category, team, tournament)

    def _validate_recorded_weight_range(self, weight, curr_category):
        min_w = curr_category.min_weight
        if min_w is not None and weight < float(min_w):
            raise serializers.ValidationError(
                f"Вага при зважуванні ({weight} кг) менша за мінімально "
                + f"допустиму для цієї категорії ({min_w} кг)."
            )
        max_w = curr_category.max_weight
        if max_w is not None and weight > float(max_w):
            raise serializers.ValidationError(
                f"Вага при зважуванні ({weight} кг) більша за максимально "
                + f"допустиму для цієї категорії ({max_w} кг)."
            )

    def _validate_weight_status(self, curr_category, attrs):
        status = attrs.get("status", self.instance.status if self.instance else "pending")
        if status == "confirmed":
            recorded_weight = self.instance.recorded_weight if self.instance else None
            if curr_category.tournament.weigh_in_required and recorded_weight is None:
                raise serializers.ValidationError(
                    "Неможливо підтвердити реєстрацію без проходження зважування."
                )
            if recorded_weight is not None:
                self._validate_recorded_weight_range(float(recorded_weight), curr_category)

    def validate(self, attrs):
        # Перевірка блокування змін для онлайн-оплат
        if (
            self.instance
            and self.instance.payment_method == "online"
            and self.instance.payment_status == "paid"
        ):
            if "payment_status" in attrs and attrs["payment_status"] != "paid":
                raise serializers.ValidationError(
                    {"payment_status": "Неможливо змінити статус успішної онлайн-оплати."}
                )
            if "payment_method" in attrs and attrs["payment_method"] != "online":
                raise serializers.ValidationError(
                    {"payment_method": "Неможливо змінити спосіб успішної онлайн-оплати."}
                )

        category = attrs.get("category")
        athlete = attrs.get("athlete")
        team = attrs.get("team")

        is_create = self.instance is None

        if category is None and self.instance:
            category = self.instance.category

        if category:
            self._validate_bracket_lock(category)
            if is_create:
                self._validate_tournament_status(category, athlete, team)
            self._validate_individual_vs_team(category, athlete, team, is_create)
            self._validate_coach_ownership(athlete, team)
            self._validate_category_audit(category, athlete, team)

        curr_category = category or (self.instance.category if self.instance else None)
        if curr_category:
            self._validate_weight_status(curr_category, attrs)

        return attrs

    def create(self, validated_data):
        category = validated_data.get("category")
        if category and not category.tournament.weigh_in_required:
            validated_data["status"] = "confirmed"
        return super().create(validated_data)


class CategoryResultSerializer(serializers.Serializer):
    """Результат розрахунку заліку для учасника в категорії."""

    place = serializers.IntegerField(allow_null=True)
    registration = RegistrationSerializer()
    wins = serializers.IntegerField()
    draws = serializers.IntegerField()
    losses = serializers.IntegerField()
    points = serializers.IntegerField()
    scores_scored = serializers.IntegerField()
    scores_conceded = serializers.IntegerField()


class RegistrationListSerializer(serializers.ModelSerializer):
    """Спрощений серіалайзер для списку учасників турніру."""

    athlete = AthleteSerializer(read_only=True)
    team = TeamSerializer(read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    club_name = serializers.SerializerMethodField()

    class Meta:
        model = Registration
        fields = [
            "id",
            "athlete",
            "team",
            "category",
            "category_name",
            "club_name",
            "status",
            "payment_status",
            "offline_refund_status",
            "created_at",
        ]

    def get_club_name(self, obj):
        if obj.athlete and obj.athlete.club:
            return obj.athlete.club.name
        if obj.team and obj.team.club:
            return obj.team.club.name
        return "—"
