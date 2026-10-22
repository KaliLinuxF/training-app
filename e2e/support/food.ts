/**
 * Mocks of the AI endpoints (the e2e server runs without an Anthropic key) and the photo files.
 * `page.route` only sees requests the page makes itself, which is why the suite blocks service
 * workers by default.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';
import type {
  FoodEstimateItem,
  FoodEstimateResponse,
  FoodStatusResponse,
} from '../../packages/shared/src/index';

/** 480×360 JPEG of a plate (e2e/fixtures/food.jpg). */
export const FOOD_JPEG = readFileSync(fileURLToPath(new URL('../fixtures/food.jpg', import.meta.url)));

/** Matches the server's photo id format (`photoIdSchema`). */
export const PHOTO_ID = 'e2ePhotoFixture000001';

/** «Борщ, хліб» → 2 positions, 320 ккал, Б 10,5 · Ж 10 · В 47. */
export const TEXT_ESTIMATE: FoodEstimateResponse = {
  photoId: null,
  items: [
    { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19 },
    { name: 'Хліб житній', portion: '2 скибки', kcal: 140, protein: 4.5, fat: 1, carbs: 28 },
  ],
  totalKcal: 320,
  comment: '',
};

/** A photo of сирники → 1 position, 420 ккал, Б 22 · Ж 22 · В 33. */
export const PHOTO_ESTIMATE: FoodEstimateResponse = {
  photoId: PHOTO_ID,
  items: [{ name: 'Сирники зі сметаною', portion: '3 шт', kcal: 420, protein: 22, fat: 22, carbs: 33 }],
  totalKcal: 420,
  comment: 'Сметана — приблизно 2 ложки',
};

/**
 * A recalculation answer («✨ Перерахувати»): exactly `items` (her names and portions, new kcal and macros) with
 * their total. `photoId` is the photo that was sent for context, if any.
 */
export function recalcAnswer(
  items: readonly FoodEstimateItem[],
  comment = '',
  photoId: string | null = null,
): FoodEstimateResponse {
  return {
    photoId,
    items: items.map((item) => ({ ...item })),
    totalKcal: items.reduce((sum, item) => sum + item.kcal, 0),
    comment,
  };
}

export interface FoodMocks {
  /** Bodies of every `POST /api/food/estimate`. */
  estimates: Record<string, unknown>[];
}

/**
 * Why a mocked status is one the server could never send, or null when it is fine. The server answers
 * `remainingToday = max(0, min(own limit − used, global ceiling − used))`, so the count is a whole number ≥ 0 and
 * never above `limitToday` (when that is sent). A spec that wants a malformed answer on purpose routes
 * `/api/food/status` itself instead of going through `mockFood`.
 */
export function foodStatusProblem(status: FoodStatusResponse): string | null {
  const { remainingToday: left, limitToday: limit } = status;
  if (!Number.isInteger(left) || left < 0) return `remainingToday must be a whole number ≥ 0, got ${left}`;
  if (limit === undefined) return null;
  if (!Number.isInteger(limit) || limit < 0) return `limitToday must be a whole number ≥ 0, got ${limit}`;
  if (left > limit) return `remainingToday (${left}) is above limitToday (${limit})`;
  return null;
}

function checkedStatus(status: FoodStatusResponse): FoodStatusResponse {
  const problem = foodStatusProblem(status);
  if (problem) throw new Error(`mockFood: impossible food status: ${problem}`);
  return status;
}

/**
 * The default mocked status: AI on, 3 of the default 40 per-user estimates used (`DEFAULT_AI_LIMITS.perUser`), the
 * same pair the «Акаунт» specs show as «Сьогодні ще 37 з 40». Above 10 left, the meal editor shows no hint.
 */
export const DEFAULT_FOOD_STATUS: Readonly<FoodStatusResponse> = Object.freeze(
  checkedStatus({ enabled: true, remainingToday: 37, limitToday: 40 }),
);

export interface FoodMockOptions {
  /** Must be a status the server could send (see `foodStatusProblem`); `mockFood` throws otherwise. */
  status?: FoodStatusResponse;
  /** Answer for the estimate endpoint: a response body, or an error `{ status, body }`. */
  estimate?: FoodEstimateResponse | { status: number; body: { error: string; message: string } };
}

const isError = (
  e: FoodMockOptions['estimate'],
): e is { status: number; body: { error: string; message: string } } =>
  typeof e === 'object' && e !== null && 'status' in e;

export async function mockFood(page: Page, opts: FoodMockOptions = {}): Promise<FoodMocks> {
  const mocks: FoodMocks = { estimates: [] };
  const status = opts.status ? checkedStatus(opts.status) : { ...DEFAULT_FOOD_STATUS };
  const estimate = opts.estimate ?? TEXT_ESTIMATE;

  await page.route('**/api/food/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/food/estimate', async (route) => {
    mocks.estimates.push(route.request().postDataJSON() as Record<string, unknown>);
    if (isError(estimate)) await route.fulfill({ status: estimate.status, json: estimate.body });
    else await route.fulfill({ json: estimate });
  });
  await page.route(
    (url) => /^\/api\/photos\/[^/]+(\/thumb)?$/.test(url.pathname),
    (route) =>
      route.fulfill({
        body: FOOD_JPEG,
        contentType: 'image/jpeg',
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
      }),
  );
  return mocks;
}

/** Whether a request is for a stored food photo (full or thumb). */
export const isPhotoRequest = (r: Request): boolean => /\/api\/photos\//.test(r.url());
