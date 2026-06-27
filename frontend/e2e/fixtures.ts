/**
 * Shared test fixtures. Import `test` / `expect` from here instead of
 * "@playwright/test" so specs get the `seedIds` fixture for free.
 *
 * To authenticate a describe block as a role:
 *     import { test, expect } from "../fixtures";
 *     import { storageStateFor } from "../helpers/roles";
 *     test.use({ storageState: storageStateFor("organizer") });
 */
import { test as base, expect } from "@playwright/test";
import { type SeedIds, loadSeedIds } from "./helpers/roles";

export const test = base.extend<{ seedIds: SeedIds }>({
  // eslint-disable-next-line no-empty-pattern
  seedIds: async ({}, provide) => {
    await provide(loadSeedIds());
  },
});

export { expect };
