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

    class Meta:
        model = Tournament
        fields = [
            "id",
            "title",
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
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            if self.instance is None:
                has_debt = Tournament.objects.filter(
                    organizer=request.user,
                    status=Tournament.Status.COMPLETED,
                    platform_fee_status="unpaid",
                    platform_fee_amount__gt=0,
                ).exists()
                if has_debt:
                    raise serializers.ValidationError(
                        "Неможливо створити турнір, оскільки у вас є "
                        "неоплачена комісія за попередні турніри."
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
    qr_token = serializers.SerializerMethodField()
    tournament_status = serializers.CharField(source="category.tournament.status", read_only=True)

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
            "seed_number",
            "recorded_weight",
            "status",
            "status_display",
            "payment_status",
            "payment_method",
            "place",
            "checked_in",
            "created_at",
            "qr_token",
        ]
        read_only_fields = ["seed_number", "recorded_weight", "place", "created_at"]

    def get_qr_token(self, obj):
        from django.core import signing

        signer = signing.Signer(salt="qr-verification")
        return signer.sign(f"reg:{obj.id}")

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

    def validate(self, attrs):
        category = attrs.get("category")
        athlete = attrs.get("athlete")
        team = attrs.get("team")

        is_create = self.instance is None

        if category is None and self.instance:
            category = self.instance.category

        if category:
            # 1. Bracket Lock Check
            if category.matches.exists():
                raise serializers.ValidationError(
                    "Категорія заблокована: сітка змагань уже сформована."
                )

            # 2. Tournament status check (only on create)
            if is_create:
                tournament = category.tournament
                if tournament.status != tournament.Status.REGISTRATION:
                    raise serializers.ValidationError(
                        "Реєстрація можлива лише тоді, коли турнір знаходиться "
                        "у статусі 'Реєстрація'."
                    )

                from django.utils import timezone

                now = timezone.now()
                if tournament.registration_start and now < tournament.registration_start:
                    raise serializers.ValidationError("Реєстрація на цей турнір ще не розпочалася.")
                if tournament.registration_end and now > tournament.registration_end:
                    raise serializers.ValidationError("Реєстрація на цей турнір вже завершилася.")

                # Uniqueness checks (since we removed UniqueTogetherValidators)
                if (
                    athlete
                    and Registration.objects.filter(athlete=athlete, category=category).exists()
                ):
                    raise serializers.ValidationError(
                        "Спортсмен уже зареєстрований у цій категорії."
                    )
                if team and Registration.objects.filter(team=team, category=category).exists():
                    raise serializers.ValidationError("Команда уже зареєстрована у цій категорії.")

            # 3. Clean logic check (individual vs team category)
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

            # 4. Coach ownership check (if coach is requesting)
            request = self.context.get("request")
            if request and request.user and request.user.is_authenticated:
                if request.user.role == "coach":
                    if athlete and athlete.coach != request.user:
                        raise serializers.ValidationError(
                            "Ви можете реєструвати лише власних спортсменів."
                        )
                    if team and team.coach != request.user:
                        raise serializers.ValidationError(
                            "Ви можете реєструвати лише власні команди."
                        )

            # 5. Smart Category Audit (Age, Weight, Gender, Skill Level)
            tournament = category.tournament
            if not category.is_team:
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
                                f"відповідає вимогам категорії ({category.allowed_skill_level})."
                            )
            else:
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
                                    f"спортсмена {tm_athlete.get_full_name()} не відповідає "
                                    f"вимогам категорії ({category.allowed_skill_level})."
                                )
        # 6. Weight/weigh-in validation for confirmed status
        curr_category = category or (self.instance.category if self.instance else None)
        if curr_category:
            status = attrs.get("status", self.instance.status if self.instance else "pending")
            if status == "confirmed":
                recorded_weight = self.instance.recorded_weight if self.instance else None
                if curr_category.tournament.weigh_in_required:
                    if recorded_weight is None:
                        raise serializers.ValidationError(
                            "Неможливо підтвердити реєстрацію без проходження зважування."
                        )
                if recorded_weight is not None:
                    weight = float(recorded_weight)
                    min_w = curr_category.min_weight
                    if min_w is not None and weight < float(min_w):
                        raise serializers.ValidationError(
                            f"Вага при зважуванні ({weight} кг) менша за мінімально "
                            f"допустиму для цієї категорії ({min_w} кг)."
                        )
                    max_w = curr_category.max_weight
                    if max_w is not None and weight > float(max_w):
                        raise serializers.ValidationError(
                            f"Вага при зважуванні ({weight} кг) більша за максимально "
                            f"допустиму для цієї категорії ({max_w} кг)."
                        )
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
