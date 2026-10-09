import { ApiError } from '@/lib/api';

/** Problems with the chosen photo, detected on the device before anything is sent. */
export type PhotoProblem = 'not_image' | 'too_big' | 'unreadable';

export class PhotoError extends Error {
  readonly problem: PhotoProblem;

  constructor(problem: PhotoProblem) {
    super(problem);
    this.name = 'PhotoError';
    this.problem = problem;
  }
}

/**
 * What the estimate was made from: the advice after a failure depends on it. `recalc`: her
 * corrected rows sent back for new kcal («✨ Перерахувати»).
 */
export type EstimateSource = 'text' | 'photo' | 'recalc';

export const ESTIMATE_MESSAGES = {
  rate_limited: 'Ліміт підрахунків на сьогодні вичерпано',
  ai_unavailable: 'Підрахунок зараз недоступний',
  /** The model could not make sense of a description she typed. */
  ai_failed_text: 'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)',
  /** …or of a photo: describing the meal in words is the way out. */
  ai_failed_photo: 'Не вдалося розпізнати — спробуй описати текстом',
  /** …or of her corrected rows: the names and amounts are hers to make clearer. */
  ai_failed_recalc: 'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну',
  payload_too_large: 'Фото завелике',
  network: 'Немає зʼєднання з сервером',
  unauthorized: 'Сесія закінчилась — увійди ще раз',
  not_image: 'Це не схоже на фото',
  too_big: 'Фото завелике — максимум 25 МБ',
  unreadable: 'Не вдалося відкрити фото',
  fallback: 'Не вдалося порахувати — спробуй ще раз',
} as const;

/** Ukrainian text (toast + inline alert) for anything an estimate attempt can throw. */
export function estimateErrorMessage(err: unknown, source: EstimateSource): string {
  if (err instanceof PhotoError) return ESTIMATE_MESSAGES[err.problem];
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ai_failed':
        return ESTIMATE_MESSAGES[`ai_failed_${source}`];
      case 'rate_limited':
      case 'ai_unavailable':
      case 'payload_too_large':
      case 'network':
      case 'unauthorized':
        return ESTIMATE_MESSAGES[err.code];
      default:
        // A proxy in front of the server answers 413/502/503 without our JSON body.
        if (err.status === 413) return ESTIMATE_MESSAGES.payload_too_large;
        if (err.status === 503) return ESTIMATE_MESSAGES.ai_unavailable;
        if (err.status === 502 || err.status === 504) return ESTIMATE_MESSAGES.network;
        return ESTIMATE_MESSAGES.fallback;
    }
  }
  if (err instanceof TypeError) return ESTIMATE_MESSAGES.network;
  return ESTIMATE_MESSAGES.fallback;
}

/**
 * The photo a recalculation sent for context is no longer on the server: the card stayed open
 * past the daily clean-up of photos no day references.
 */
export function isPhotoGone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.code === 'not_found';
}

/** The request was aborted on purpose («Скасувати», sheet closed). */
export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof DOMException && err.name === 'AbortError';
}
