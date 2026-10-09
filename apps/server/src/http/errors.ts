import type { ApiErrorCode, ErrorResponse } from '@legko/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** User-facing (Ukrainian) messages; the `error` code is what clients branch on. */
export const MESSAGES = {
  unauthorized: 'Потрібно увійти',
  badPassword: 'Неправильний пароль',
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
  notJpeg: 'Фото має бути у форматі JPEG',
  photoTooLarge: 'Фото завелике',
  badPhotoId: 'Некоректний ідентифікатор фото',
  photoNotFound: 'Фото не знайдено',
  internal: 'Помилка сервера',
} as const;

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  error: ApiErrorCode,
  message: string,
  extra: Pick<ErrorResponse, 'index'> = {},
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
