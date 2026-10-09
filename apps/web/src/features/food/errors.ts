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

export const ESTIMATE_MESSAGES = {
  rate_limited: 'Ліміт підрахунків на сьогодні вичерпано',
  ai_unavailable: 'Підрахунок зараз недоступний',
  ai_failed: 'Не вдалося розпізнати — спробуй описати текстом',
  payload_too_large: 'Фото завелике',
  network: 'Немає зʼєднання з сервером',
  unauthorized: 'Сесія закінчилась — увійди ще раз',
  not_image: 'Це не схоже на фото',
  too_big: 'Фото завелике — максимум 25 МБ',
  unreadable: 'Не вдалося відкрити фото',
  fallback: 'Не вдалося порахувати — спробуй ще раз',
} as const;

/** Ukrainian toast text for anything an estimate attempt can throw. */
export function estimateErrorMessage(err: unknown): string {
  if (err instanceof PhotoError) return ESTIMATE_MESSAGES[err.problem];
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'rate_limited':
      case 'ai_unavailable':
      case 'ai_failed':
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

/** The request was aborted on purpose («Скасувати», sheet closed). */
export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof DOMException && err.name === 'AbortError';
}
