/**
 * Playwright global setup.
 *
 *   1. Seeds deterministic users + baseline data by piping e2e/seed.py into the
 *      backend container's Django shell.
 *   2. Persists one storageState file per role from the sessions the seed emits,
 *      so specs authenticate WITHOUT calling the throttled login endpoint.
 *   3. Records baseline object ids in .auth/seed-ids.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDjangoShell } from "./helpers/backend";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(HERE, ".auth");

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

function cookie(name: string, value: string, httpOnly: boolean): Cookie {
  return {
    name,
    value,
    domain: "localhost",
    path: "/",
    expires: -1,
    httpOnly,
    secure: false,
    sameSite: "Lax",
  };
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });

  const seed = readFileSync(join(HERE, "seed.py"), "utf-8");
  let output: string;
  try {
    output = runDjangoShell(seed);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      "E2E seed failed. Is the docker stack running?\n" +
        (e.stdout ?? "") +
        (e.stderr ?? "") +
        (e.message ?? ""),
    );
  }

  if (!output.includes("E2E_SEED_DONE")) {
    throw new Error("E2E seed did not finish cleanly:\n" + output);
  }

  const roles: string[] = [];
  const ids: Record<string, number> = {};

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("E2E_SESSION|")) {
      const [, role, sid, csrf] = line.split("|");
      const state = {
        cookies: [cookie("sessionid", sid, true), cookie("csrftoken", csrf, false)],
        origins: [],
      };
      writeFileSync(join(AUTH_DIR, `${role}.json`), JSON.stringify(state, null, 2));
      roles.push(role);
    } else if (line.startsWith("E2E_IDS|")) {
      for (const pair of line.split("|").slice(1)) {
        const [k, v] = pair.split("=");
        ids[k] = Number(v);
      }
    }
  }

  if (roles.length === 0) {
    throw new Error("No sessions parsed from seed output:\n" + output);
  }

  writeFileSync(join(AUTH_DIR, "seed-ids.json"), JSON.stringify(ids, null, 2));
  console.log(`[e2e] seeded roles: ${roles.join(", ")} | ids: ${JSON.stringify(ids)}`);
}
