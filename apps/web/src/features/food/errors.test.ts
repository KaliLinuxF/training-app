import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { estimateErrorMessage, isAbort, isPhotoGone, PhotoError } from './errors';

describe('estimateErrorMessage', () => {
  it('maps server error codes to Ukrainian messages', () => {
    const msg = (status: number, code: ConstructorParameters<typeof ApiError>[1]) =>
      estimateErrorMessage(new ApiError(status, code, 'x'), 'text');
    expect(msg(429, 'rate_limited')).toBe('Ліміт підрахунків на сьогодні вичерпано');
    expect(msg(503, 'ai_unavailable')).toBe('Підрахунок зараз недоступний');
    expect(msg(413, 'payload_too_large')).toBe('Фото завелике');
    expect(msg(0, 'network')).toBe('Немає зʼєднання з сервером');
  });

  it('a failed recognition gives advice that fits what she sent', () => {
    const failed = new ApiError(502, 'ai_failed', 'Не вдалося порахувати калорії');
    // She just described it in words: asking her to «describe it in text» would make no sense.
    expect(estimateErrorMessage(failed, 'text')).toBe(
      'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)',
    );
    expect(estimateErrorMessage(failed, 'photo')).toBe('Не вдалося розпізнати — спробуй описати текстом');
    // Her corrected rows: the way out is a clearer name or amount, or her own number.
    expect(estimateErrorMessage(failed, 'recalc')).toBe(
      'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну',
    );
    expect(estimateErrorMessage(new ApiError(429, 'rate_limited', 'x'), 'recalc')).toBe(
      'Ліміт підрахунків на сьогодні вичерпано',
    );
  });

  it('falls back on the HTTP status when a proxy answered without JSON', () => {
    const msg = (err: ApiError) => estimateErrorMessage(err, 'photo');
    expect(msg(new ApiError(413, 'internal', 'Payload Too Large'))).toBe('Фото завелике');
    expect(msg(new ApiError(503, 'internal', 'Service Unavailable'))).toBe('Підрахунок зараз недоступний');
    expect(msg(new ApiError(502, 'internal', 'Bad Gateway'))).toBe('Немає зʼєднання з сервером');
    expect(msg(new ApiError(400, 'bad_request', 'nope'))).toBe('Не вдалося порахувати — спробуй ще раз');
  });

  it('explains photo problems', () => {
    expect(estimateErrorMessage(new PhotoError('not_image'), 'photo')).toBe('Це не схоже на фото');
    expect(estimateErrorMessage(new PhotoError('too_big'), 'photo')).toBe('Фото завелике — максимум 25 МБ');
    expect(estimateErrorMessage(new PhotoError('unreadable'), 'photo')).toBe('Не вдалося відкрити фото');
  });

  it('anything else gets a generic message', () => {
    expect(estimateErrorMessage(new Error('boom'), 'text')).toBe('Не вдалося порахувати — спробуй ще раз');
    expect(estimateErrorMessage(new TypeError('Failed to fetch'), 'text')).toBe('Немає зʼєднання з сервером');
  });
});

describe('isPhotoGone', () => {
  it('is the server’s 404 for a photo it no longer has, nothing else', () => {
    expect(isPhotoGone(new ApiError(404, 'not_found', 'Фото не знайдено'))).toBe(true);
    expect(isPhotoGone(new ApiError(404, 'internal', 'Not Found'))).toBe(false);
    expect(isPhotoGone(new ApiError(400, 'bad_request', 'x'))).toBe(false);
    expect(isPhotoGone(new ApiError(0, 'network', 'x'))).toBe(false);
    expect(isPhotoGone(new Error('not_found'))).toBe(false);
  });
});

describe('isAbort', () => {
  it('detects an aborted signal or an AbortError', () => {
    const ctrl = new AbortController();
    expect(isAbort(new ApiError(0, 'network', 'x'), ctrl.signal)).toBe(false);
    ctrl.abort();
    expect(isAbort(new ApiError(0, 'network', 'x'), ctrl.signal)).toBe(true);
    expect(isAbort(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbort(new Error('x'))).toBe(false);
  });
});
