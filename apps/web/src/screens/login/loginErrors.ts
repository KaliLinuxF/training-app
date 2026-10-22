import { MONTHS_GEN, type LinkProblem } from '@legko/shared';
import { ApiError } from '../../lib/api';
import { isIOS } from '../../lib/platform';

export const LOGIN_ERRORS = {
  badCredentials: 'Неправильне імʼя або пароль',
  rateLimited: 'Забагато спроб — спробуй за кілька хвилин',
  accountDisabled: 'Акаунт вимкнено. Звернись до адміністратора',
  network: 'Немає зʼєднання з сервером',
  other: 'Щось пішло не так',
} as const;

/**
 * Under the error box after a wrong name / password or too many attempts. While it shows, the login footer
 * (`LOGIN_FOOTER`, the same advice) is hidden.
 */
export const FORGOT_HINT = 'Не памʼятаєш пароль? Попроси в адміністратора посилання для нового пароля.';

/** Ukrainian message for a failed `api.login()` (an unknown name answers exactly like a wrong password). */
export function loginErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'bad_credentials' || err.code === 'bad_password') return LOGIN_ERRORS.badCredentials;
    if (err.code === 'rate_limited') return LOGIN_ERRORS.rateLimited;
    if (err.code === 'account_disabled') return LOGIN_ERRORS.accountDisabled;
    if (err.isNetwork) return LOGIN_ERRORS.network;
  }
  return LOGIN_ERRORS.other;
}

/** Whether the forgotten-password hint follows this failure. */
export function showsForgotHint(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.code === 'bad_credentials' || err.code === 'bad_password' || err.code === 'rate_limited')
  );
}

/**
 * Focus a field only with a mouse/trackpad: on a phone the keyboard jumping up
 * before she even looked at the screen is annoying.
 */
export function canAutofocus(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || isIOS()) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

// ---- one-time links (invite / reset) -------------------------------------------------------

/*
 * The allowed symbols are named, each followed by itself in brackets. A no-break space (U+00A0) keeps «крапка (.)»,
 * «дефіс (-)» and «підкреслення (_)» together, so a bare «_» or «-» never ends up alone at a line end.
 * The same wording belongs in screens/settings/account/accountModel.ts and the server's invalid_username message.
 */
export const USERNAME_HINT =
  '3–32 символи: латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)';
export const PASSWORD_HINT = 'Щонайменше 8 символів';

export const LINK_FORM_ERRORS = {
  usernameTaken: 'Це імʼя вже зайняте — обери інше',
  usernameReserved: 'Це імʼя зарезервоване — обери інше',
  invalidUsername:
    'Імʼя: 3–32 символи — латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
  weakPassword: 'Пароль — щонайменше 8 символів',
  mismatch: 'Паролі не збігаються',
} as const;

/** «Посилання не працює» copy of an invite, per reason (§9.2). */
export const INVITE_INVALID: Record<LinkProblem, string> = {
  used: 'Це запрошення вже використали. Якщо акаунт за ним уже створено — просто ввійди.',
  expired: 'Строк дії запрошення минув.',
  revoked: 'Запрошення скасовано.',
  unknown: 'Посилання неправильне або неповне.',
};

/** «Посилання не працює» copy of a reset / setup link, per reason (§9.3). */
export const RESET_INVALID: Record<LinkProblem, string> = {
  used: 'Це посилання вже використали. Якщо пароль уже змінено — увійди з ним.',
  expired: 'Строк дії посилання минув.',
  revoked: 'Посилання скасовано — є новіше.',
  unknown: 'Посилання неправильне або неповне.',
};

/** Follows every reason but `used` (the person most likely tapped their own link again). */
export const ASK_ADMIN = 'Попроси в адміністратора нове.';
export const LINK_INVALID_TITLE = 'Посилання не працює';

/** Ukrainian message for a failed link request that is not about the link itself (rate limit, network, …). */
export function linkRequestErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited') return LOGIN_ERRORS.rateLimited;
    if (err.code === 'account_disabled') return LOGIN_ERRORS.accountDisabled;
    if (err.code === 'weak_password') return LINK_FORM_ERRORS.weakPassword;
    if (err.code === 'invalid_username') return LINK_FORM_ERRORS.invalidUsername;
    if (err.code === 'username_taken') return LINK_FORM_ERRORS.usernameTaken;
    if (err.isNetwork) return LOGIN_ERRORS.network;
  }
  return LOGIN_ERRORS.other;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** «28 жовтня» (this device's time zone). */
export function untilDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()] ?? ''}`;
}

/** «22 жовтня, 14:05» (this device's time zone). */
export function untilDateTime(ms: number): string {
  const d = new Date(ms);
  return `${untilDate(ms)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
