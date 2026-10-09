import {
  API,
  foodEstimateRequestSchema,
  zonedNow,
  type FoodEstimateResponse,
  type FoodStatusResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { FoodAiError, totalKcal } from '../../food/estimator';
import { decodeUpload, type PhotoUpload } from '../../photos/store';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** Full photo (≤ 2.8 M base64 chars) + thumbnail (≤ 0.4 M) + text, as JSON: ≈ 3.3 MB at most. */
export const FOOD_ESTIMATE_MAX_BYTES = 4 * 1024 * 1024;

const MINUTES_PER_DAY = 24 * 60;

export function registerFoodRoutes(app: Hono<AppEnv>, { data, auth, now, photos, food }: RouteDeps): void {
  const { estimator, budget } = food;

  /** The user's local day and the seconds left in it (budget window). */
  const localDay = (): { date: string; secondsLeft: number } => {
    const z = zonedNow(data.settings().timezone, new Date(now()));
    return { date: z.date, secondsLeft: (MINUTES_PER_DAY - z.minutes) * 60 };
  };

  const limitReached = (c: Context, secondsLeft: number): Response => {
    c.header('Retry-After', String(secondsLeft));
    return apiError(c, 429, 'rate_limited', MESSAGES.foodLimit);
  };

  app.get(API.foodStatus, auth, (c) => {
    const body: FoodStatusResponse = {
      enabled: estimator !== null,
      remainingToday: budget.remaining(localDay().date),
    };
    return c.json(body);
  });

  app.post(
    API.foodEstimate,
    auth,
    bodyLimit({
      maxSize: FOOD_ESTIMATE_MAX_BYTES,
      onError: (c) => apiError(c, 413, 'payload_too_large', MESSAGES.photoTooLarge),
    }),
    async (c) => {
      const body = await readJson(c);
      if (!body) return badRequest(c, MESSAGES.badJson);
      const parsed = foodEstimateRequestSchema.safeParse(body.value);
      if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
      if (!estimator) return apiError(c, 503, 'ai_unavailable', MESSAGES.aiUnavailable);
      const { date, text = '', image } = parsed.data;

      let upload: PhotoUpload | null = null;
      if (image) {
        const decoded = decodeUpload(image);
        if (!decoded.ok) {
          return decoded.problem === 'too_large'
            ? apiError(c, 413, 'payload_too_large', MESSAGES.photoTooLarge)
            : badRequest(c, MESSAGES.notJpeg);
        }
        upload = decoded.photo;
      }

      const day = localDay();
      if (budget.remaining(day.date) === 0) return limitReached(c, day.secondsLeft);
      // Stored before the model call (SPEC §3.7). If the estimate fails, no day references the
      // photo and the daily clean-up removes it.
      const photoId = upload ? await photos.save(upload, date) : null;
      // Re-checked atomically: a parallel request may have used the last call meanwhile.
      if (!budget.tryConsume(day.date)) return limitReached(c, day.secondsLeft);

      try {
        const estimate = await estimator.estimate({
          text,
          // Canonical base64 of the validated bytes (the schema only checks the alphabet).
          imageBase64: upload ? upload.full.toString('base64') : null,
        });
        const res: FoodEstimateResponse = {
          photoId,
          items: estimate.items,
          totalKcal: totalKcal(estimate.items),
          comment: estimate.comment,
        };
        return c.json(res);
      } catch (err) {
        if (!(err instanceof FoodAiError)) throw err;
        return err.code === 'ai_unavailable'
          ? apiError(c, 503, 'ai_unavailable', MESSAGES.aiUnavailable)
          : apiError(c, 502, 'ai_failed', MESSAGES.aiFailed);
      }
    },
  );
}
