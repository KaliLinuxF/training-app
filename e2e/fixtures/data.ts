/**
 * Data sets the tests import into the server (`POST /api/import`) before they start.
 * The demo set is the dev seed script's generator (apps/server/scripts/seed-demo.ts), so the
 * suite sees exactly what developers see locally.
 */
import { demoData } from '../../apps/server/scripts/seed-demo';
import { emptyData, type AppData } from '../../packages/shared/src/index';
import { TODAY } from '../support/env';

export type SeedName = 'demo' | 'empty' | 'onboarded';

/** ~10 weeks of realistic records ending today (today: food only, no kcal / workout mark yet). */
export const demo = (): AppData => demoData(TODAY);

/** A brand-new account: nothing recorded, not onboarded (the setup sheet opens by itself). */
export const empty = (): AppData => emptyData();

/** Nothing recorded, but the first-run setup is done (no setup sheet). */
export function onboarded(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  return data;
}

export function seedData(name: SeedName): AppData {
  switch (name) {
    case 'demo':
      return demo();
    case 'empty':
      return empty();
    case 'onboarded':
      return onboarded();
  }
}

export { demoData };
