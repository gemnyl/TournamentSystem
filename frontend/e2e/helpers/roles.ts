/**
 * Role registry, credentials, and storageState paths shared across specs.
 * storageState files are produced by global-setup.ts (one per role).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = join(HERE, "..", ".auth");

export type Role =
  | "admin"
  | "organizer"
  | "coach"
  | "coach2"
  | "judge"
  | "staff"
  | "spectator";

export const E2E_PASSWORD = "E2ePass123!";

export const CREDENTIALS: Record<Role, { email: string; password: string }> = {
  admin: { email: "e2e_admin@test.local", password: E2E_PASSWORD },
  organizer: { email: "e2e_organizer@test.local", password: E2E_PASSWORD },
  coach: { email: "e2e_coach@test.local", password: E2E_PASSWORD },
  coach2: { email: "e2e_coach2@test.local", password: E2E_PASSWORD },
  judge: { email: "e2e_judge@test.local", password: E2E_PASSWORD },
  staff: { email: "e2e_staff@test.local", password: E2E_PASSWORD },
  spectator: { email: "e2e_spectator@test.local", password: E2E_PASSWORD },
};

/** Absolute path to the storageState file for a role (use with test.use). */
export function storageStateFor(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}

export interface SeedIds {
  club: number;
  tournament: number;
  category: number;
}

/** IDs of baseline seed objects, written by global-setup. */
export function loadSeedIds(): SeedIds {
  const file = join(AUTH_DIR, "seed-ids.json");
  if (!existsSync(file)) {
    throw new Error(`seed-ids.json missing at ${file}; did global-setup run?`);
  }
  return JSON.parse(readFileSync(file, "utf-8")) as SeedIds;
}

/** Read the csrftoken stored in a role's storageState (for API write helpers). */
export function csrfTokenFor(role: Role): string {
  const state = JSON.parse(readFileSync(storageStateFor(role), "utf-8")) as {
    cookies: { name: string; value: string }[];
  };
  const token = state.cookies.find((c) => c.name === "csrftoken")?.value;
  if (!token) throw new Error(`No csrftoken in storageState for ${role}`);
  return token;
}
