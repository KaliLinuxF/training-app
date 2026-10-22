import type { ApiErrorCode, ErrorResponse } from '@legko/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import {
  AccountDisabled,
  AccountError,
  AlreadyAdmin,
  ConfirmMismatch,
  ExistsAsUser,
  InvalidUsername,
  LastAdmin,
  LinkInvalid,
  SelfAction,
  TooManyInvites,
  UserNotFound,
  UsernameTaken,
  WeakPassword,
  WrongPassword,
} from '../auth/accounts';

/** User-facing (Ukrainian) messages; the `error` code is what clients branch on. */
export const MESSAGES = {
  unauthorized: 'Потрібно увійти',
  rateLimited: 'Забагато спроб. Спробуй пізніше',
  badJson: 'Некоректний JSON',
  tooLarge: 'Завеликий запит',
  forbiddenOrigin: 'Запит з недозволеного джерела',
  needsJson: 'Потрібен Content-Type: application/json',
  notFound: 'Не знайдено',
  pushUnavailable: 'Сповіщення недоступні на сервері',
  aiUnavailable: 'Підрахунок калорій зараз недоступний',
  aiFailed: 'Не вдалося порахувати калорії. Спробуй ще раз або опиши страву словами',
  foodLimit: 'Ліміт підрахунків на сьогодні вичерпано',
  globalFoodLimit: 'Підрахунки на сьогодні закінчилися. Спробуй завтра',
  notJpeg: 'Фото має бути у форматі JPEG',
  photoTooLarge: 'Фото завелике',
  badPhotoId: 'Некоректний ідентифікатор фото',
  photoNotFound: 'Фото не знайдено',
  /** `GET /api/coach/clients`: missing / invalid dates, to < from or more than 62 days. */
  badWindow: 'Некоректний період',
  internal: 'Помилка сервера',
  // Accounts (docs/multi-user.md §6.3).
  badCredentials: 'Неправильне імʼя або пароль',
  /** A username-less (pre-v4 bundle) login failed: there is no name to get wrong (D24). */
  badPassword: 'Неправильний пароль',
  accountDisabled: 'Акаунт вимкнено. Звернись до адміністратора',
  forbidden: 'Немає доступу',
  userMismatch: 'На цьому пристрої ввійдено в інший акаунт',
  linkInvalid: 'Посилання не працює',
  usernameTaken: 'Це імʼя вже зайняте',
  /** Same wording as the web client's rule text (no-break spaces keep each symbol next to its name). */
  // prettier-ignore
  invalidUsername: 'Імʼя: 3–32 символи — латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
  weakPassword: 'Пароль — щонайменше 8 символів',
  wrongPassword: 'Поточний пароль неправильний',
  lastAdmin: 'Це єдиний адміністратор',
  selfAction: 'Із власним акаунтом так не можна',
  tooManyInvites: 'Забагато активних запрошень — скасуй старі',
  confirmMismatch: 'Імʼя для підтвердження не збігається',
} as const;

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  error: ApiErrorCode,
  message: string,
  extra: Pick<ErrorResponse, 'index' | 'reason'> = {},
): Response {
  const body: ErrorResponse = { error, message, ...extra };
  return c.json(body, status);
}

/** Short description of the first validation problem, e.g. `value.kcal: Too big`. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Некоректні дані';
  const where = issue.path.map(String).join('.');
  return where ? `Некоректні дані (${where}): ${issue.message}` : `Некоректні дані: ${issue.message}`;
}

export const badRequest = (c: Context, message: string): Response => apiError(c, 400, 'bad_request', message);

/** Parses the JSON body; null when it is not valid JSON. */
export async function readJson(c: Context): Promise<{ value: unknown } | null> {
  try {
    const value: unknown = await c.req.json();
    return { value };
  } catch {
    return null;
  }
}

/**
 * The API answer for a typed account error (§6.3), or null for anything else (rethrow it). `LinkInvalid` carries its
 * `reason`.
 */
export function accountErrorResponse(c: Context, err: unknown): Response | null {
  if (err instanceof UsernameTaken) return apiError(c, 409, 'username_taken', MESSAGES.usernameTaken);
  if (!(err instanceof AccountError)) return null;
  if (err instanceof LinkInvalid)
    return apiError(c, 410, 'link_invalid', MESSAGES.linkInvalid, { reason: err.reason });
  if (err instanceof InvalidUsername) return apiError(c, 400, 'invalid_username', MESSAGES.invalidUsername);
  if (err instanceof WeakPassword) return apiError(c, 400, 'weak_password', MESSAGES.weakPassword);
  if (err instanceof WrongPassword) return apiError(c, 403, 'wrong_password', MESSAGES.wrongPassword);
  if (err instanceof AccountDisabled) return apiError(c, 403, 'account_disabled', MESSAGES.accountDisabled);
  if (err instanceof UserNotFound) return apiError(c, 404, 'not_found', MESSAGES.notFound);
  if (err instanceof LastAdmin) return apiError(c, 409, 'last_admin', MESSAGES.lastAdmin);
  if (err instanceof SelfAction) return apiError(c, 409, 'self_action', MESSAGES.selfAction);
  if (err instanceof TooManyInvites) return apiError(c, 409, 'limit_reached', MESSAGES.tooManyInvites);
  if (err instanceof ConfirmMismatch) return apiError(c, 400, 'bad_request', MESSAGES.confirmMismatch);
  if (err instanceof AlreadyAdmin || err instanceof ExistsAsUser)
    return apiError(c, 409, 'username_taken', MESSAGES.usernameTaken);
  return null;
}
