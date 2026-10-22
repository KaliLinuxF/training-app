/**
 * View logic of «Користувачі» (docs/multi-user.md §9.6). Pure functions only: UsersPage, LinkCard and UserSheet wire
 * them to the admin API. Copy is gender-neutral (D22).
 */
import {
  AI_LIMIT_BOUNDS,
  type AdminInvite,
  type AdminUser,
  type AiLimits,
  type UserRole,
} from '@legko/shared';
import { ApiError } from '@/lib/api';
import type { ConfirmOptions } from '@/store/ui';
import type { PillTone } from '@/ui';
import { dayTime, dayWord, longDate, shortDate, untilDateTime } from '../dates';
import { plural } from '../model';

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  user: 'Користувач',
  admin: 'Адміністратор',
};

export const USERS_COPY = {
  loading: 'Завантажую…',
  loadFailed: 'Не вдалося завантажити',
  retry: 'Спробувати ще раз',
  offline: 'Потрібен інтернет',
  inviteTitle: 'Запросити людину',
  noteLabel: 'Підпис (для себе)',
  notePlaceholder: 'Напр., для Олі',
  createInvite: 'Створити запрошення',
  creatingInvite: 'Створюю…',
  inviteNote: 'Посилання одноразове й діє 7 днів. Людина сама обере імʼя і пароль.',
  invitesTitle: 'Запрошення',
  noNote: 'Без підпису',
  revoke: 'Скасувати',
  revoked: 'Запрошення скасовано',
  accountsTitle: 'Акаунти',
  // One name for the AI estimates everywhere: «підрахунки» (as on «Акаунт»).
  aiTitle: 'Підрахунки калорій',
  aiSubtitle: 'Ліміти на день',
  // Short labels (one line next to the stepper at 320–390px; the subtitle says «на день»); the steppers' names
  // keep the whole phrase and start with the label.
  aiPerUser: 'На людину',
  aiPerUserName: 'На людину за день',
  aiGlobal: 'Усього',
  aiGlobalName: 'Усього за день',
  aiZeroHint: '0 — підрахунки вимкнено.',
  saveLimits: 'Зберегти ліміти',
  saved: 'Збережено',
  never: 'Ще не входили',
} as const;

// ---- invites --------------------------------------------------------------------------

/** The row title of a pending invite: its note, or «Без підпису». */
export function inviteTitle(invite: Pick<AdminInvite, 'note'>): string {
  return invite.note.trim() || USERS_COPY.noNote;
}

/** «до 28 жовтня · від admin», «до 28 жовтня · з консолі» (made with the CLI). */
export function inviteSub(invite: Pick<AdminInvite, 'expiresAt' | 'createdBy'>): string {
  const from = invite.createdBy === null ? 'з консолі' : `від ${invite.createdBy}`;
  return `до ${shortDate(invite.expiresAt)} · ${from}`;
}

export const REVOKE_CONFIRM: ConfirmOptions = {
  title: 'Скасувати запрошення?',
  body: 'Посилання перестане працювати.',
  confirmLabel: 'Скасувати запрошення',
  cancelLabel: 'Залишити',
  destructive: true,
};

// ---- one-time links (LinkCard) --------------------------------------------------------

/** What a LinkCard shows: a new invite, a reset link, or a first-password link for an account without one. */
export type LinkPurpose = 'invite' | 'reset' | 'setup';

export const LINK_COPY = {
  inviteTitle: 'Запрошення готове',
  resetTitle: 'Посилання готове',
  urlLabel: 'Посилання',
  copy: 'Скопіювати',
  share: 'Поділитися',
  done: 'Готово',
  copied: 'Скопійовано',
  selected: 'Посилання виділено — скопіюй його вручну',
  onlyNow: 'Посилання видно тільки зараз — надішли його або збережи.',
} as const;

/** The expiry line under the link, worded like the invite / reset pages («Посилання одноразове, діє до …»). */
export function linkExpiryLine(purpose: LinkPurpose, expiresAt: number): string {
  if (purpose === 'invite') return `Одноразове, діє до ${untilDateTime(expiresAt)}.`;
  if (purpose === 'setup') return 'Одноразове, діє 24 години.';
  return 'Одноразове, діє 24 години. Старий пароль працює, доки посиланням не скористаються.';
}

/**
 * What «Поділитися» hands to `navigator.share`. Messengers drop the title, so the text carries the explanation; the
 * link itself is the `url`. «Home Fit» without quotes, as on the invite page («Запрошення в Home Fit»).
 */
export function shareData(purpose: LinkPurpose, url: string, expiresAt: number): ShareData {
  if (purpose === 'invite') {
    return {
      title: 'Запрошення в Home Fit',
      text: `Запрошую в Home Fit — трекер схуднення. Посилання одноразове, діє до ${shortDate(expiresAt)}.`,
      url,
    };
  }
  return {
    title: 'Новий пароль у Home Fit',
    text: 'Посилання для нового пароля в Home Fit, діє 24 години.',
    url,
  };
}

// ---- accounts -------------------------------------------------------------------------

/** A usable admin: role admin, not disabled, with a password (D18). */
export const isUsableAdmin = (u: Pick<AdminUser, 'role' | 'status'>): boolean =>
  u.role === 'admin' && u.status === 'active';

/** The last usable admin cannot be demoted, disabled or deleted (the server refuses with `last_admin`). */
export function isLastUsableAdmin(user: AdminUser, users: readonly AdminUser[]): boolean {
  return isUsableAdmin(user) && users.filter(isUsableAdmin).length <= 1;
}

export interface UserPill {
  text: string;
  tone: Extract<PillTone, 'acc' | 'neutral'>;
}

/** «Адмін», «Вимкнено», «Пароль не задано» next to the name. */
export function userPills(user: Pick<AdminUser, 'role' | 'status'>): UserPill[] {
  const pills: UserPill[] = [];
  if (user.role === 'admin') pills.push({ text: 'Адмін', tone: 'acc' });
  if (user.status === 'disabled') pills.push({ text: 'Вимкнено', tone: 'neutral' });
  if (user.status === 'pending') pills.push({ text: 'Пароль не задано', tone: 'neutral' });
  return pills;
}

const capitalize = (text: string): string =>
  text ? `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}` : text;

/** «1 підрахунок», «3 підрахунки», «5 підрахунків» (the AI estimates). */
export const estimatesCount = (n: number): string =>
  `${n} ${plural(n, 'підрахунок', 'підрахунки', 'підрахунків')}`;

/**
 * The row's second line: «Це ти · активність сьогодні», «Активність сьогодні · 3 підрахунки сьогодні», «Ще не
 * входили». The estimates are left out while there are none.
 */
export function userRowSub(user: AdminUser, now: number = Date.now()): string {
  const parts: string[] = [];
  if (user.lastSeenAt === null) {
    parts.push(user.self ? 'Це ти' : USERS_COPY.never);
  } else {
    const activity = `активність ${dayWord(user.lastSeenAt, now)}`;
    parts.push(...(user.self ? ['Це ти', activity] : [capitalize(activity)]));
  }
  if (user.ai.today > 0) parts.push(`${estimatesCount(user.ai.today)} сьогодні`);
  return parts.join(' · ');
}

/** The lines at the top of the user sheet. */
export function userFacts(
  user: AdminUser,
  now: number = Date.now(),
): { since: string; activity: string; ai: string } {
  return {
    since: `${ROLE_LABELS[user.role]} · з ${longDate(user.createdAt)}`,
    activity: user.lastSeenAt === null ? USERS_COPY.never : `Активність: ${dayTime(user.lastSeenAt, now)}`,
    ai: `Підрахунки: сьогодні ${user.ai.today} · за 30 днів ${user.ai.last30Days}`,
  };
}

export const SHEET_COPY = {
  role: 'Роль',
  lastAdminHint: 'Єдиний адміністратор — спершу признач іншого',
  roleChanged: 'Роль змінено',
  // A client's sheet only: a link to their records in «Клієнти» (read-only).
  clientRecords: 'Записи й прогрес',
  customLimit: 'Окремий ліміт підрахунків',
  dailyLimit: 'Ліміт на день',
  saveLimit: 'Зберегти ліміт',
  limitOff: 'Для цього акаунта підрахунки вимкнено',
  resetLink: 'Посилання для нового пароля',
  setupLink: 'Посилання для пароля',
  enableFirst: 'Щоб надіслати посилання, спершу ввімкни акаунт.',
  disable: 'Вимкнути акаунт',
  enable: 'Увімкнути акаунт',
  disabled: 'Акаунт вимкнено',
  enabled: 'Акаунт увімкнено',
  deleteOpen: 'Видалити акаунт…',
  deleteBody:
    'Буде видалено всі записи цього акаунта — дні, прийоми їжі, фото, вагу, заміри, налаштування. ' +
    'Відновити їх буде неможливо.',
  deleteInput: 'Імʼя для підтвердження',
  deleteConfirm: 'Видалити назавжди',
  cancel: 'Скасувати',
} as const;

/** «Як у всіх: 40 на день» under the switch while the account follows the default («45 на день» when its own). */
export const defaultLimitText = (perUser: number): string => `Як у всіх: ${perUser} на день`;

export const deleteTitle = (username: string): string => `Видалити акаунт ${username}?`;
export const deletePrompt = (username: string): string => `Щоб підтвердити, введи імʼя: ${username}`;
export const deletedToast = (username: string): string => `Акаунт ${username} видалено`;

/** The typed name matches the account's (case-insensitive, surrounding spaces ignored). */
export function deleteNameMatches(typed: string, username: string): boolean {
  return typed.trim().toLowerCase() === username.trim().toLowerCase();
}

/** Asked before a role change; `self` = the admin changes their own role. */
export function roleConfirm(username: string, role: UserRole, self: boolean): ConfirmOptions {
  if (role === 'admin') {
    return {
      title: `Зробити ${username} адміністратором?`,
      body:
        'Адміністратор бачить усі акаунти, а також записи й прогрес кожного користувача — лише для перегляду, ' +
        'змінити їх він не може. Він запрошує, вимикає й видаляє акаунти та може видати посилання для нового ' +
        'пароля — людина про це дізнається.',
      confirmLabel: 'Зробити адміністратором',
    };
  }
  return {
    title: self ? 'Забрати права адміністратора в себе?' : `Забрати права адміністратора в ${username}?`,
    body: 'Розділи «Користувачі» й «Клієнти» зникнуть для цього акаунта, а його записи й прогрес бачитимуть адміністратори.',
    confirmLabel: 'Забрати права',
    destructive: true,
  };
}

/** Asked before an account is disabled (enabling needs no confirm). */
export function disableConfirm(username: string): ConfirmOptions {
  return {
    title: `Вимкнути акаунт ${username}?`,
    body:
      'Увійти в нього буде неможливо, усі його пристрої вийдуть з акаунта, нагадування зупиняться. Записи ' +
      'збережуться — акаунт можна знову ввімкнути.',
    confirmLabel: 'Вимкнути',
    destructive: true,
  };
}

// ---- AI limits ------------------------------------------------------------------------

export interface LimitRange {
  min: number;
  max: number;
  step: number;
}

export const AI_LIMIT_STEPS: Readonly<Record<keyof AiLimits, LimitRange>> = {
  perUser: { ...AI_LIMIT_BOUNDS.perUser, step: 5 },
  global: { ...AI_LIMIT_BOUNDS.global, step: 10 },
};

/**
 * One step up or down onto the step grid (42 → 45 / 40 with step 5), never leaving the range; a value outside it
 * moves one step towards it.
 */
export function stepLimit(value: number, dir: 1 | -1, { min, max, step }: LimitRange): number {
  if (dir === 1) {
    if (value >= max) return value;
    return Math.max(min, Math.min(max, Math.floor(value / step) * step + step));
  }
  if (value <= min) return value;
  return Math.min(max, Math.max(min, Math.ceil(value / step) * step - step));
}

/** «Сьогодні використано 12 з 150.» */
export const aiTodayLine = (used: number, ceiling: number): string =>
  `Сьогодні використано ${used} з ${ceiling}.`;

// ---- errors ---------------------------------------------------------------------------

/** What an admin action was about, for the `not_found` wording. */
export type AdminAction = 'invite' | 'revoke' | 'user' | 'delete' | 'limits';

export const ADMIN_ERRORS = {
  lastAdmin: 'Це єдиний адміністратор',
  selfAction: 'Із власним акаунтом так не можна',
  accountDisabled: 'Акаунт вимкнено — спершу ввімкни його',
  tooManyInvites: 'Забагато активних запрошень — скасуй старі',
  inviteGone: 'Це запрошення вже використали або скасували',
  userGone: 'Цього акаунта вже немає',
  confirmMismatch: 'Імʼя для підтвердження не збігається',
  rateLimited: 'Забагато спроб — спробуй за кілька хвилин',
  network: 'Немає зʼєднання з сервером',
  other: 'Щось пішло не так',
} as const;

/** Ukrainian text for a failed admin request. */
export function adminErrorText(err: unknown, action: AdminAction): string {
  if (!(err instanceof ApiError)) return ADMIN_ERRORS.other;
  switch (err.code) {
    case 'last_admin':
      return ADMIN_ERRORS.lastAdmin;
    case 'self_action':
      return ADMIN_ERRORS.selfAction;
    case 'account_disabled':
      return ADMIN_ERRORS.accountDisabled;
    case 'limit_reached':
      return ADMIN_ERRORS.tooManyInvites;
    case 'not_found':
      return action === 'revoke' ? ADMIN_ERRORS.inviteGone : ADMIN_ERRORS.userGone;
    case 'bad_request':
      return action === 'delete' ? ADMIN_ERRORS.confirmMismatch : ADMIN_ERRORS.other;
    case 'rate_limited':
      return ADMIN_ERRORS.rateLimited;
    default:
      return err.isNetwork ? ADMIN_ERRORS.network : ADMIN_ERRORS.other;
  }
}
