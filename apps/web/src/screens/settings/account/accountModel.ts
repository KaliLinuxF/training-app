/**
 * View logic of «Акаунт» (docs/multi-user.md §9.5): the profile line, where the password came from (D28), the
 * change-password and rename checks and the Ukrainian error texts. Pure functions only.
 */
import {
  PASSWORD_LIMITS,
  usernameProblem,
  type FoodStatusResponse,
  type PasswordChange,
  type SessionUser,
} from '@legko/shared';
import { ApiError } from '@/lib/api';
import { LINK_FORM_ERRORS, USERNAME_HINT } from '../../login/loginErrors';
import { calendarDate, longDate } from '../dates';
import { ROLE_LABELS } from '../users/usersModel';

export const ACCOUNT_COPY = {
  profile: 'Профіль',
  passwordTitle: 'Пароль',
  currentPassword: 'Поточний пароль',
  newPassword: 'Новий пароль',
  repeatPassword: 'Повтори новий пароль',
  passwordHint: 'Щонайменше 8 символів',
  changePassword: 'Змінити пароль',
  changingPassword: 'Змінюю…',
  passwordChanged: 'Пароль змінено',
  otherDevices: 'Інші пристрої вийдуть з акаунта, цей — ні.',
  usernameTitle: 'Імʼя для входу',
  edit: 'Змінити',
  newUsername: 'Нове імʼя',
  /** The same rule text as the invite form (screens/login/loginErrors.ts). */
  usernameHint: USERNAME_HINT,
  password: 'Пароль',
  saveUsername: 'Зберегти імʼя',
  savingUsername: 'Зберігаю…',
  cancel: 'Скасувати',
  usernameChanged: 'Імʼя змінено',
  loginWithNew: 'Після зміни входь з новим імʼям.',
  aiTitle: 'Підрахунки калорій',
  offline: 'Потрібен інтернет',
  loading: 'Завантажую…',
  /** The profile card's third line, role user only (docs/coach-cabinet.md §7.1): no pop-up, nothing else. */
  adminSees: 'Адміністратор бачить твої записи та прогрес.',
} as const;

export const ACCOUNT_ERRORS = {
  currentMissing: 'Введи поточний пароль',
  wrongPassword: 'Поточний пароль неправильний',
  renameWrongPassword: 'Пароль неправильний',
  passwordMissing: 'Введи пароль',
  mismatch: 'Паролі не збігаються',
  weakPassword: 'Новий пароль — щонайменше 8 символів',
  usernameTaken: 'Це імʼя вже зайняте',
  invalidUsername: LINK_FORM_ERRORS.invalidUsername,
  reserved: 'Це імʼя зарезервоване — обери інше',
  rateLimited: 'Забагато спроб — спробуй за кілька хвилин',
  network: 'Немає зʼєднання з сервером',
  other: 'Щось пішло не так',
} as const;

/** «Користувач · з 9 жовтня 2026», «Адміністратор · з 21 жовтня 2026». */
export function profileLine(user: Pick<SessionUser, 'role' | 'createdAt'>): string {
  return `${ROLE_LABELS[user.role]} · з ${longDate(user.createdAt)}`;
}

/** The avatar letter: the first character of the name, upper case. */
export function avatarLetter(username: string): string {
  const first = Array.from(username.trim())[0];
  return first ? first.toLocaleUpperCase('uk') : '?';
}

/**
 * Where the current password came from (D28), or null when nothing is known:
 * - `self` «Пароль змінено 21 жовтня.»
 * - `reset` / `setup` «Пароль задано 21 жовтня за посиланням від admin.» («… з консолі.» when the link came from the
 *   CLI or its creator is gone)
 * - `cli` «Пароль задано 21 жовтня на сервері.»
 */
export function provenanceLine(change: PasswordChange | null, now: number = Date.now()): string | null {
  if (!change) return null;
  const date = calendarDate(change.at, now);
  switch (change.via) {
    case 'self':
      return `Пароль змінено ${date}.`;
    case 'cli':
      return `Пароль задано ${date} на сервері.`;
    case 'reset':
    case 'setup':
      return change.by === null
        ? `Пароль задано ${date} за посиланням з консолі.`
        : `Пароль задано ${date} за посиланням від ${change.by}.`;
  }
}

/** «Сьогодні ще 37 з 40»; «Сьогодні ще 37» when the server sends no limit. */
export function aiLeftText(status: Pick<FoodStatusResponse, 'remainingToday' | 'limitToday'>): string {
  const left = Number.isFinite(status.remainingToday) ? Math.max(0, Math.floor(status.remainingToday)) : 0;
  const limit = status.limitToday;
  return typeof limit === 'number' && Number.isFinite(limit)
    ? `Сьогодні ще ${left} з ${limit}`
    : `Сьогодні ще ${left}`;
}

// ---- forms ----------------------------------------------------------------------------

export type PasswordField = 'current' | 'next' | 'repeat';
export type RenameField = 'username' | 'password';

/** A form error: its text and the field it belongs to (null = the whole form, e.g. a rate limit). */
export interface FormError<F extends string> {
  field: F | null;
  text: string;
}

export interface PasswordDraft {
  current: string;
  next: string;
  repeat: string;
}

/** Checks the change-password form before sending it. */
export function checkPasswordForm({ current, next, repeat }: PasswordDraft): FormError<PasswordField> | null {
  if (!current) return { field: 'current', text: ACCOUNT_ERRORS.currentMissing };
  if (next.length < PASSWORD_LIMITS.min) return { field: 'next', text: ACCOUNT_ERRORS.weakPassword };
  if (next !== repeat) return { field: 'repeat', text: ACCOUNT_ERRORS.mismatch };
  return null;
}

/** The common answers of both forms: rate limit, network, anything else. */
function commonError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited') return ACCOUNT_ERRORS.rateLimited;
    if (err.isNetwork) return ACCOUNT_ERRORS.network;
  }
  return ACCOUNT_ERRORS.other;
}

/** A failed `api.account.changePassword()`. */
export function passwordErrorFrom(err: unknown): FormError<PasswordField> {
  if (err instanceof ApiError) {
    if (err.code === 'wrong_password') return { field: 'current', text: ACCOUNT_ERRORS.wrongPassword };
    if (err.code === 'weak_password') return { field: 'next', text: ACCOUNT_ERRORS.weakPassword };
  }
  return { field: null, text: commonError(err) };
}

export interface RenameDraft {
  username: string;
  password: string;
}

/** The text for a name `usernameProblem` refuses. */
function usernameProblemText(name: string): string | null {
  const problem = usernameProblem(name);
  if (problem === null) return null;
  return problem === 'reserved' ? ACCOUNT_ERRORS.reserved : ACCOUNT_ERRORS.invalidUsername;
}

/**
 * Checks the rename form before sending it: `'unchanged'` when the name is exactly the current one (nothing to do).
 * Another case of the same name («Anna» for «anna») is a rename.
 */
export function checkRenameForm(
  { username, password }: RenameDraft,
  current: string,
): FormError<RenameField> | 'unchanged' | null {
  const name = username.trim();
  if (name === current) return 'unchanged';
  const problem = usernameProblemText(name);
  if (problem) return { field: 'username', text: problem };
  if (!password) return { field: 'password', text: ACCOUNT_ERRORS.passwordMissing };
  return null;
}

/** A failed `api.account.rename()`. */
export function renameErrorFrom(err: unknown): FormError<RenameField> {
  if (err instanceof ApiError) {
    if (err.code === 'wrong_password') return { field: 'password', text: ACCOUNT_ERRORS.renameWrongPassword };
    if (err.code === 'username_taken') return { field: 'username', text: ACCOUNT_ERRORS.usernameTaken };
    if (err.code === 'invalid_username') return { field: 'username', text: ACCOUNT_ERRORS.invalidUsername };
  }
  return { field: null, text: commonError(err) };
}
