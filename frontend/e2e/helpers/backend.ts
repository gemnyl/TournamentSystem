/**
 * Helpers that talk to the Django backend running inside the docker container.
 *
 * E2E runs against the live docker-compose stack (frontend :80, backend :8000).
 * Some flows can only be driven server-side: reading console-emailed
 * confirmation codes, clearing the DRF throttle cache, and creating sessions.
 *
 * Container name and compose project are overridable via env so CI can adapt.
 */
import { execFileSync } from "node:child_process";

const CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "tournament-webservice-backend-1";

/** Pipe a multi-line Python script into `manage.py shell` (stdin). */
export function runDjangoShell(script: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "python", "manage.py", "shell"], {
    input: script,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Run a single Python statement via `manage.py shell -c`. */
export function runDjangoCode(code: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "python", "manage.py", "shell", "-c", code],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
}

/** Clear the default LocMemCache — resets the DRF "auth" throttle counters. */
export function resetThrottle(): void {
  runDjangoCode("from django.core.cache import cache; cache.clear()");
}

/** Latest e-mail confirmation code for a user (console email backend). */
export function getEmailConfirmationCode(email: string): string {
  const code = `from apps.accounts.models import EmailConfirmationCode as C; print(C.objects.get(user__email=${py(email)}).code)`;
  return runDjangoCode(code).trim().split("\n").pop()!.trim();
}

/** Latest password-reset code for a user. */
export function getPasswordResetCode(email: string): string {
  const code = `from apps.accounts.models import PasswordResetCode as C; print(C.objects.get(user__email=${py(email)}).code)`;
  return runDjangoCode(code).trim().split("\n").pop()!.trim();
}

/** Delete a user (and cascade) so a registration spec can re-run cleanly. */
export function deleteUser(email: string): void {
  runDjangoCode(`from apps.accounts.models import User; User.objects.filter(email=${py(email)}).delete()`);
}

/** Mark a user banned/unbanned for RBAC + login tests. */
export function setUserBanned(email: string, banned: boolean): void {
  runDjangoCode(
    `from apps.accounts.models import User; User.objects.filter(email=${py(email)}).update(is_banned=${banned ? "True" : "False"})`,
  );
}

const DEFAULT_E2E_PASSWORD = "E2ePass123!";

/**
 * (Re)create an inactive, unverified user with a known confirmation code,
 * bypassing the throttled /register/ endpoint. Returns the code.
 */
export function createUnverifiedUser(email: string, password = DEFAULT_E2E_PASSWORD): string {
  const code = "123456";
  runDjangoCode(
    [
      "from datetime import timedelta",
      "from django.utils import timezone",
      "from apps.accounts.models import User, EmailConfirmationCode",
      `User.objects.filter(email=${py(email)}).delete()`,
      `u = User.objects.create_user(email=${py(email)}, password=${py(password)}, first_name="E2E", last_name="Unverified", is_active=False, email_verified=False, name_locked=True)`,
      `EmailConfirmationCode.objects.create(user=u, code=${py(code)}, expires_at=timezone.now() + timedelta(minutes=15))`,
    ].join("; "),
  );
  return code;
}

/**
 * (Re)create an active, verified spectator with a known password,
 * for password-reset and login specs. Profile is left incomplete on purpose.
 */
export function createVerifiedUser(email: string, password = DEFAULT_E2E_PASSWORD): void {
  runDjangoCode(
    [
      "from apps.accounts.models import User",
      `User.objects.filter(email=${py(email)}).delete()`,
      `User.objects.create_user(email=${py(email)}, password=${py(password)}, first_name="E2E", last_name="Verified", is_active=True, email_verified=True, name_locked=True)`,
    ].join("; "),
  );
}

/**
 * (Re)create an active, verified spectator with a COMPLETE profile (phone +
 * birth date) so login lands on /tournaments instead of bouncing to /profile.
 * Use for logout/session specs that need an isolated, throwaway session.
 */
export function createCompleteUser(email: string, password = DEFAULT_E2E_PASSWORD): void {
  runDjangoCode(
    [
      "from datetime import date",
      "from apps.accounts.models import User",
      `User.objects.filter(email=${py(email)}).delete()`,
      `User.objects.create_user(email=${py(email)}, password=${py(password)}, first_name="E2E", last_name="Session", is_active=True, email_verified=True, name_locked=True, phone="+380991112233", birth_date=date(1990, 1, 1))`,
    ].join("; "),
  );
}

/** Delete athletes by last name (cleanup for athlete-CRUD specs). */
export function deleteAthlete(lastName: string): void {
  runDjangoCode(
    `from apps.athletes.models import Athlete; Athlete.objects.filter(last_name=${py(lastName)}).delete()`,
  );
}

/** Delete tournaments by title (cleanup for isolated tournament/category specs). */
export function deleteTournament(title: string): void {
  runDjangoCode(
    `from apps.tournaments.models import Tournament; Tournament.objects.filter(title=${py(title)}).delete()`,
  );
}

/**
 * Force every registration in a category to confirmed + paid.
 * Bracket generation requires both flags, but auto-confirm leaves payment unpaid.
 */
export function markCategoryPaid(categoryId: number): void {
  runDjangoCode(
    `from apps.tournaments.models import Registration; Registration.objects.filter(category_id=${categoryId}).update(status="confirmed", payment_status="paid")`,
  );
}

/** Python string literal (double-quoted, escaped). */
function py(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
