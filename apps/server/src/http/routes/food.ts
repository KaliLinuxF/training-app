import {
  API,
  foodEstimateRequestSchema,
  type FoodEstimateResponse,
  type FoodRecalcItem,
  type FoodStatusResponse,
  type ISODate,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import {
  applyRecalculation,
  FoodAiError,
  totalKcal,
  type FoodEstimate,
  type FoodEstimator,
} from '../../food/estimator';
import { decodeUpload, type PhotoUpload } from '../../photos/store';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** The estimate-mode part of a validated request. */
interface EstimateFields {
  date: ISODate;
  /** Trimmed; empty when only a photo is sent. */
  text: string;
  image: { full: string; thumb: string } | undefined;
}

export function registerFoodRoutes(app: Hono<AppEnv>, { auth, now, photos, food }: RouteDeps): void {
  const { estimator, budget } = food;

  const limitReached = (c: Context): Response => {
    c.header('Retry-After', String(budget.secondsUntilReset(now())));
    return apiError(c, 429, 'rate_limited', MESSAGES.foodLimit);
  };

  /** Counts one model call against the daily budget, makes it and maps its failures. */
  async function callModel(
    c: Context,
    photoId: string | null,
    run: () => Promise<FoodEstimate>,
  ): Promise<Response> {
    // Atomic: a parallel request may have used the last call meanwhile.
    if (!budget.tryConsume(now())) return limitReached(c);
    try {
      const estimate = await run();
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
  }

  /** Estimate mode: the model identifies the items in her description and/or a new photo. */
  async function estimate(c: Context, model: FoodEstimator, request: EstimateFields): Promise<Response> {
    const { date, text, image } = request;
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

    if (budget.remaining(now()) === 0) return limitReached(c);
    // Stored before the model call (SPEC §3.7). If the estimate fails, no day references the
    // photo and the daily clean-up removes it.
    const photoId = upload ? await photos.save(upload, date) : null;
    return callModel(c, photoId, () =>
      model.estimate({
        text,
        // Canonical base64 of the validated bytes (the schema only checks the alphabet).
        imageBase64: upload ? upload.full.toString('base64') : null,
      }),
    );
  }

  /**
   * Recalculate mode: the model only prices her corrected items; the response echoes them as sent
   * with the new kcal. The photo she estimated from is already stored and is only read here.
   */
  async function recalculate(
    c: Context,
    model: FoodEstimator,
    items: readonly FoodRecalcItem[],
    photoId: string | null,
  ): Promise<Response> {
    let imageBase64: string | null = null;
    if (photoId !== null) {
      const full = await photos.read(photoId, 'full');
      if (!full) return apiError(c, 404, 'not_found', MESSAGES.photoNotFound);
      imageBase64 = Buffer.from(full).toString('base64');
    }
    return callModel(c, photoId, async () =>
      applyRecalculation(items, await model.recalculate({ items, imageBase64 })),
    );
  }

  app.get(API.foodStatus, auth, (c) => {
    const body: FoodStatusResponse = {
      enabled: estimator !== null,
      remainingToday: budget.remaining(now()),
    };
    return c.json(body);
  });

  app.post(API.foodEstimate, auth, limitBody(BODY_LIMITS.foodEstimate, MESSAGES.photoTooLarge), async (c) => {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = foodEstimateRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    if (!estimator) return apiError(c, 503, 'ai_unavailable', MESSAGES.aiUnavailable);
    const { date, text = '', image, items, photoId } = parsed.data;
    // With `items` it is a recalculation; `text` is not used then.
    return items
      ? recalculate(c, estimator, items, photoId ?? null)
      : estimate(c, estimator, { date, text, image });
  });
}
