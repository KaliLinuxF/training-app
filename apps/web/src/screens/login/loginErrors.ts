import { ApiError } from '../../lib/api';
import { isIOS } from '../../lib/platform';

export const LOGIN_ERRORS = {
  badPassword: 'Невірний пароль',
  rateLimited: 'Забагато спроб — спробуй за кілька хвилин',
  network: 'Немає зʼєднання з сервером',
  other: 'Щось пішло не так',
} as const;

/** Ukrainian message for a failed `api.login()`. */
export function loginErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'bad_password') return LOGIN_ERRORS.badPassword;
    if (err.code === 'rate_limited') return LOGIN_ERRORS.rateLimited;
    if (err.isNetwork) return LOGIN_ERRORS.network;
  }
  return LOGIN_ERRORS.other;
}

/**
 * Focus the password field only with a mouse/trackpad: on a phone the keyboard jumping up
 * before she even looked at the screen is annoying.
 */
export function canAutofocus(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || isIOS()) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
