"""
Idempotent E2E seed script.

Piped into the running backend container's Django shell by global-setup.ts:

    docker exec -i <backend> python manage.py shell < e2e/seed.py

Responsibilities:
  * Ensure a deterministic set of role users exist (verified, with phone +
    birth_date so ProtectedRoute does not bounce them to /profile), each with
    a known password.
  * Ensure baseline reference data (a club, a few athletes, one tournament in
    "registration" status with a category) so read-only / dashboard specs have
    something to show. Specs that mutate state create their own isolated data
    via the API.
  * Emit a machine-readable session + CSRF token per role on stdout so that
    global-setup can persist Playwright storageState WITHOUT calling the
    throttled /api/auth/login/ endpoint.

Output protocol (parsed by global-setup.ts):
    E2E_SESSION|<role>|<sessionid>|<csrftoken>
    E2E_IDS|club=<id>|tournament=<id>|category=<id>
    E2E_SEED_DONE
"""

from datetime import date, timedelta
from importlib import import_module

from django.conf import settings
from django.middleware.csrf import get_token
from django.test import RequestFactory
from django.utils import timezone

from apps.accounts.models import Club, User
from apps.athletes.models import Athlete
from apps.tournaments.models import Category, Tournament

PASSWORD = "E2ePass123!"

# role -> email. Two coaches so coach-vs-coach isolation can be tested.
USERS = {
    "admin": "e2e_admin@test.local",
    "organizer": "e2e_organizer@test.local",
    "coach": "e2e_coach@test.local",
    "coach2": "e2e_coach2@test.local",
    "judge": "e2e_judge@test.local",
    "staff": "e2e_staff@test.local",
    "spectator": "e2e_spectator@test.local",
}


def ensure_user(key, email):
    real_role = "coach" if key == "coach2" else key
    user, _ = User.objects.get_or_create(
        email=email,
        defaults={"first_name": key.capitalize(), "last_name": "E2E"},
    )
    user.first_name = key.capitalize()
    user.last_name = "E2E"
    user.role = real_role
    user.email_verified = True
    user.is_active = True
    user.is_banned = False
    user.phone = "+380000000000"
    user.birth_date = date(1990, 1, 1)
    user.gender = "male"
    user.name_locked = False
    if real_role == "admin":
        user.is_staff = True
        user.is_superuser = True
    if real_role == "coach":
        user.is_club_leader = True
    user.set_password(PASSWORD)
    user.save()
    return user


def make_storage(user):
    """Create a DB session + a valid CSRF token without hitting the login API."""
    engine = import_module(settings.SESSION_ENGINE)
    store = engine.SessionStore()
    store["_auth_user_id"] = str(user.pk)
    store["_auth_user_backend"] = "django.contrib.auth.backends.ModelBackend"
    store["_auth_user_hash"] = user.get_session_auth_hash()
    store.save()
    csrf = get_token(RequestFactory().get("/"))
    return store.session_key, csrf


users = {key: ensure_user(key, email) for key, email in USERS.items()}

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------
club, _ = Club.objects.get_or_create(name="E2E Club", defaults={"region": "kyiv_city"})

coach = users["coach"]
coach.club = club
coach.save(update_fields=["club"])

athlete_specs = [
    ("Андрій", "Боєць", "male", date(2008, 5, 1), 60),
    ("Богдан", "Швидкий", "male", date(2008, 7, 12), 62),
    ("Вікторія", "Сильна", "female", date(2009, 3, 3), 55),
    ("Галина", "Влучна", "female", date(2009, 9, 20), 57),
]
for first, last, gender, bd, weight in athlete_specs:
    Athlete.objects.get_or_create(
        coach=coach,
        first_name=first,
        last_name=last,
        defaults={
            "club": club,
            "gender": gender,
            "birth_date": bd,
            "base_weight": weight,
        },
    )

# One baseline tournament in "registration" status owned by the organizer.
now = timezone.now()
tournament, _ = Tournament.objects.get_or_create(
    organizer=users["organizer"],
    title="E2E Seed Tournament",
    defaults={
        "sport_type": "Карате",
        "location": "Київ",
        "start_date": now + timedelta(days=14),
        "end_date": now + timedelta(days=15),
        "registration_start": now - timedelta(days=1),
        "registration_end": now + timedelta(days=10),
        "status": Tournament.Status.REGISTRATION,
        "weigh_in_required": True,
        "base_registration_fee": 500,
    },
)
tournament.staff_members.add(users["staff"])
tournament.judges.add(users["judge"])

category, _ = Category.objects.get_or_create(
    tournament=tournament,
    name="Куміте Ю16 -60кг",
    defaults={
        "allowed_gender": "male",
        "min_age": 14,
        "max_age": 16,
        "min_weight": 50,
        "max_weight": 60,
        "bracket_format": Category.BracketFormat.SINGLE_ELIMINATION,
        "ruleset_key": "karate_wkf",
    },
)

# ---------------------------------------------------------------------------
# Emit sessions for storageState
# ---------------------------------------------------------------------------
for key, user in users.items():
    sid, csrf = make_storage(user)
    print(f"E2E_SESSION|{key}|{sid}|{csrf}")

print(f"E2E_IDS|club={club.id}|tournament={tournament.id}|category={category.id}")
print("E2E_SEED_DONE")
