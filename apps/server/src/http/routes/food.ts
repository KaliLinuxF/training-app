import {
  API,
  foodEstimateRequestSchema,
  type FoodEstimateResponse,
  type FoodRecalcItem,
  type FoodStatusResponse,
  type ISODate,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import type { UserBudget } from '../../food/budget';
import {
  applyRecalculation,
  FoodAiError,
  totalKcal,
  type FoodEstimate,
  type FoodEstimator,
} from '../../food/estimator';
import { decodeUpload, type PhotoUpload, type UserPhotos } from '../../photos/store';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** The estimate-mode part of a validated request. */
interface EstimateFields {
  date: ISODate;
  /** Trimmed; empty when only a photo is sent. */
  text: string;
  image: { full: string; thumb: string } | undefined;
}

/** What one request may touch: the signed-in user's photos and budget (docs/multi-user.md §5.2–§5.3). */
interface Scope {
  photos: UserPhotos;
  budget: UserBudget;
}

type Exhausted = 'user_limit' | 'global_limit';

export function registerFoodRoutes(app: Hono<AppEnv>, { auth, now, photos, food }: RouteDeps): void {
  const { estimator, budget } = food;

  const scopeOf = (c: Context<AppEnv>): Scope => {
    const { id } = currentUser(c);
    return { photos: photos.forUser(id), budget: budget.forUser(id) };
  };

  const limitReached = (c: Context, reason: Exhausted): Response => {
    c.header('Retry-After', String(budget.secondsUntilReset(now())));
    return apiError(
      c,
      429,
      'rate_limited',
      reason === 'user_limit' ? MESSAGES.foodLimit : MESSAGES.globalFoodLimit,
    );
  };

  /**
   * Counts one model call against her budget and the global one (her own allowance is reported first, D16). Atomic:
   * of parallel requests for the last call exactly one gets it. Null when counted; otherwise the 429 to send.
   */
  const reserve = (c: Context, scope: Scope): Response | null => {
    const consumed = scope.budget.tryConsume(now());
    return consumed === 'ok' ? null : limitReached(c, consumed);
  };

  /** Makes the model call already counted by `reserve` and maps its failures. */
  async function callModel(
    c: Context,
    photoId: string | null,
    run: () => Promise<FoodEstimate>,
  ): Promise<Response> {
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
  async function estimate(
    c: Context,
    scope: Scope,
    model: FoodEstimator,
    request: EstimateFields,
  ): Promise<Response> {
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

    // Counted BEFORE the photo is stored: a burst of parallel requests stores at most as many photos as she has
    // estimates left (a refused one stores nothing). A failed save or model call still counts, like a failed call.
    const refused = reserve(c, scope);
    if (refused) return refused;
    // Stored as hers before the model call (SPEC §3.7). If the estimate fails, no day references the
    // photo and the daily clean-up removes it.
    const photoId = upload ? await scope.photos.save(upload, date) : null;
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
   * with the new kcal. The photo she estimated from is already stored and is only read here — her own
   * photos only: another user's id is «not found» like a missing one.
   */
  async function recalculate(
    c: Context,
    scope: Scope,
    model: FoodEstimator,
    items: readonly FoodRecalcItem[],
    photoId: string | null,
  ): Promise<Response> {
    let imageBase64: string | null = null;
    if (photoId !== null) {
      const full = await scope.photos.read(photoId, 'full');
      if (!full) return apiError(c, 404, 'not_found', MESSAGES.photoNotFound);
      imageBase64 = Buffer.from(full).toString('base64');
    }
    const refused = reserve(c, scope);
    if (refused) return refused;
    return callModel(c, photoId, async () =>
      applyRecalculation(items, await model.recalculate({ items, imageBase64 })),
    );
  }

  app.get(API.foodStatus, auth, (c) => {
    const own = budget.forUser(currentUser(c).id);
    const body: FoodStatusResponse = {
      // A limit of 0 (hers, or everybody's ceiling saved in «Користувачі») means AI is off, not «used up today» (D16).
      enabled: estimator !== null && own.limit() > 0 && budget.limits().global > 0,
      remainingToday: own.remaining(now()),
      limitToday: own.limit(),
    };
    return c.json(body);
  });

  app.post(API.foodEstimate, auth, limitBody(BODY_LIMITS.foodEstimate, MESSAGES.photoTooLarge), async (c) => {
    const scope = scopeOf(c);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = foodEstimateRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    if (!estimator) return apiError(c, 503, 'ai_unavailable', MESSAGES.aiUnavailable);
    const { date, text = '', image, items, photoId } = parsed.data;
    // With `items` it is a recalculation; `text` is not used then.
    return items
      ? recalculate(c, scope, estimator, items, photoId ?? null)
      : estimate(c, scope, estimator, { date, text, image });
  });
}
