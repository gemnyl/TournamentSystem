/**
 * Authenticated APIRequestContext helpers for fast, isolated test-data setup.
 *
 * Specs that need their own tournament / category / athletes create them via
 * the REST API as the appropriate role instead of mutating shared seed data.
 */
import { type APIRequestContext, type BrowserContext, request } from "@playwright/test";
import { type Role, csrfTokenFor, storageStateFor } from "./roles";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost";

/** A standalone request context carrying a role's session + CSRF header. */
export async function newApiContext(role: Role): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE_URL,
    storageState: storageStateFor(role),
    extraHTTPHeaders: { "X-CSRFToken": csrfTokenFor(role) },
  });
}

/** Read the csrftoken cookie from a live browser context (for in-page writes). */
export async function csrfFromContext(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const token = cookies.find((c) => c.name === "csrftoken")?.value;
  if (!token) throw new Error("csrftoken cookie not present in context");
  return token;
}

interface CreateTournamentOpts {
  title?: string;
  sport_type?: string;
  status?: "draft" | "registration" | "active" | "completed";
  base_registration_fee?: number;
  weigh_in_required?: boolean;
  /**
   * Keep the tournament visibly in draft. By default registration_start is in
   * the past, so the backend auto-promotes draft → registration on read. Set
   * this to push registration_start into the future and stay in draft so the UI
   * still offers the "Відкрити реєстрацію" control.
   */
  keepDraft?: boolean;
}

/**
 * Create a tournament as the organizer and return its id.
 * Status transitions go through the lifecycle endpoints when needed.
 */
export async function createTournament(
  api: APIRequestContext,
  opts: CreateTournamentOpts = {},
): Promise<number> {
  const now = Date.now();
  const start = new Date(now + 14 * 864e5).toISOString();
  const end = new Date(now + 15 * 864e5).toISOString();
  const res = await api.post("/api/tournaments/", {
    data: {
      title: opts.title ?? `E2E Tournament ${now}`,
      sport_type: opts.sport_type ?? "Карате",
      location: "Київ",
      start_date: start,
      end_date: end,
      registration_start: new Date(opts.keepDraft ? now + 864e5 : now - 864e5).toISOString(),
      registration_end: new Date(now + 10 * 864e5).toISOString(),
      weigh_in_required: opts.weigh_in_required ?? false,
      base_registration_fee: opts.base_registration_fee ?? 500,
    },
  });
  if (!res.ok()) {
    throw new Error(`createTournament failed: ${res.status()} ${await res.text()}`);
  }
  const t = (await res.json()) as { id: number };

  if (opts.status && opts.status !== "draft") {
    await api.post(`/api/tournaments/${t.id}/open_registration/`);
    if (opts.status === "active" || opts.status === "completed") {
      await api.post(`/api/tournaments/${t.id}/start/`);
    }
    if (opts.status === "completed") {
      await api.post(`/api/tournaments/${t.id}/complete/`);
    }
  }
  return t.id;
}

interface CreateCategoryOpts {
  name?: string;
  allowed_gender?: "male" | "female" | "mixed";
  min_age?: number;
  max_age?: number;
  bracket_format?: string;
}

/**
 * Create a category in a tournament. Defaults are intentionally broad
 * (mixed gender, age 5–100, no weight bounds) so the seed coach's athletes
 * are always eligible to register.
 */
export async function createCategory(
  api: APIRequestContext,
  tournamentId: number,
  opts: CreateCategoryOpts = {},
): Promise<number> {
  const res = await api.post("/api/categories/", {
    data: {
      tournament: tournamentId,
      name: opts.name ?? `E2E Категорія ${Date.now()}`,
      allowed_gender: opts.allowed_gender ?? "mixed",
      min_age: opts.min_age ?? 5,
      max_age: opts.max_age ?? 100,
      bracket_format: opts.bracket_format ?? "single_elimination",
      ruleset_key: "karate_wkf",
    },
  });
  if (!res.ok()) {
    throw new Error(`createCategory failed: ${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { id: number }).id;
}

/** Register an athlete in a category. Auto-confirms when weigh-in is off. */
export async function registerAthlete(
  api: APIRequestContext,
  categoryId: number,
  athleteId: number,
): Promise<number> {
  const res = await api.post("/api/registrations/", {
    data: { category: categoryId, athlete_id: athleteId },
  });
  if (!res.ok()) {
    throw new Error(`registerAthlete failed: ${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { id: number }).id;
}

/** Create a tatami (mat) in a tournament. Organizer/chief-judge only. */
export async function createTatami(
  api: APIRequestContext,
  tournamentId: number,
  number: number,
  opts: { name?: string; is_active?: boolean } = {},
): Promise<number> {
  const res = await api.post("/api/tatamis/", {
    data: {
      tournament: tournamentId,
      number,
      name: opts.name ?? "",
      is_active: opts.is_active ?? true,
    },
  });
  if (!res.ok()) {
    throw new Error(`createTatami failed: ${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { id: number }).id;
}

/** Generate a competition bracket for a category (organizer/chief-judge only). */
export async function generateBracket(
  api: APIRequestContext,
  categoryId: number,
  format = "single_elimination",
): Promise<void> {
  const res = await api.post(`/api/categories/${categoryId}/generate_bracket/`, {
    data: { bracket_format: format },
  });
  if (!res.ok()) {
    throw new Error(`generateBracket failed: ${res.status()} ${await res.text()}`);
  }
}

/** Athlete ids visible to the role (a coach sees only their own). */
export async function listAthleteIds(api: APIRequestContext): Promise<number[]> {
  const res = await api.get("/api/athletes/");
  if (!res.ok()) {
    throw new Error(`listAthleteIds failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { results?: { id: number }[] } | { id: number }[];
  const rows = Array.isArray(body) ? body : (body.results ?? []);
  return rows.map((r) => r.id);
}
