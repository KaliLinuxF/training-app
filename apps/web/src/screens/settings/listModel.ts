/**
 * The «Налаштування» list: sections, routes, row icons and the one-line summaries shown on each row.
 * Pure functions only — SettingsList wires them to the store, the push status and the theme.
 */
import {
  f0,
  fN,
  normalizeTypeNames,
  WORKOUT_TYPES,
  type AdminOverview,
  type Reminders,
  type SessionUser,
  type Settings,
} from '@legko/shared';
import type { PushStatus } from '@/lib/push';
import type { ThemePref } from '@/lib/theme';
import type { SyncState } from '@/store/data';
import type { IconName, ListIconTone, PillTone } from '@/ui';
import { plural, REMINDER_ORDER, syncStatus, THEME_OPTIONS, type SyncStatusView } from './model';

// ---- sections & routes ----------------------------------------------------------------

/** URL slugs of the sub-pages (`/settings/:section`). `users` is shown to admins only. */
export type SettingsSectionId =
  'reminders' | 'goals' | 'workouts' | 'meals' | 'appearance' | 'data' | 'account' | 'users';

export const SETTINGS_ROOT = '/settings';

export function settingsPath(id: SettingsSectionId): string {
  return `${SETTINGS_ROOT}/${id}`;
}

/** Row titles; also the sub-page <h1> (phone) and the pane <h2> (desktop). */
export const SECTION_TITLES: Readonly<Record<SettingsSectionId, string>> = {
  reminders: 'Нагадування',
  goals: 'Цілі',
  workouts: 'Тренування',
  meals: 'Прийоми їжі',
  appearance: 'Вигляд',
  data: 'Дані і копія',
  account: 'Акаунт',
  users: 'Користувачі',
};

export const SECTION_ICONS: Readonly<Record<SettingsSectionId, { icon: IconName; tone: ListIconTone }>> = {
  reminders: { icon: 'bell', tone: 'acc' },
  goals: { icon: 'target', tone: 'acc2' },
  workouts: { icon: 'workout', tone: 'acc' },
  meals: { icon: 'food', tone: 'acc2' },
  appearance: { icon: 'theme', tone: 'neutral' },
  data: { icon: 'data', tone: 'acc2' },
  account: { icon: 'user', tone: 'acc' },
  users: { icon: 'users', tone: 'acc2' },
};

/**
 * The list's groups, in order: what she plans with, the app itself, then the account. The last group takes the
 * place of the old «Вийти» card (docs/multi-user.md D30); its «Користувачі» row is for admins only (`settingsGroups`).
 */
export const SETTINGS_GROUPS: readonly (readonly SettingsSectionId[])[] = [
  ['reminders', 'goals', 'workouts', 'meals'],
  ['appearance', 'data'],
  ['account', 'users'],
];

/** Sections only an admin may open (everyone else is sent back to the list). */
export const ADMIN_SECTIONS: readonly SettingsSectionId[] = ['users'];

/** The groups the signed-in person sees: without the admin-only rows unless `isAdmin`. */
export function settingsGroups(isAdmin: boolean): SettingsSectionId[][] {
  return SETTINGS_GROUPS.map((group) => group.filter((id) => isAdmin || !ADMIN_SECTIONS.includes(id))).filter(
    (group) => group.length > 0,
  );
}

/** Whether `id` may be opened by this person (`users` needs an admin). */
export function canOpenSection(id: SettingsSectionId, isAdmin: boolean): boolean {
  return isAdmin || !ADMIN_SECTIONS.includes(id);
}

/**
 * The caption «Home Fit · трекер схуднення» under the list shows for users and is hidden while the «Користувачі» row
 * shows: the admin's extra row would otherwise make the list scroll on a 390×763 iPhone (D30).
 */
export function showsCaption(groups: readonly (readonly SettingsSectionId[])[]): boolean {
  return !groups.some((group) => group.includes('users'));
}

const SECTION_IDS: readonly string[] = SETTINGS_GROUPS.flat();

/** The detail shown next to the list at `/settings` on desktop (no redirect, the URL stays). */
export const DESKTOP_DEFAULT_SECTION: SettingsSectionId = 'reminders';

/**
 * The `:section` route param: `null` for the list itself (`/settings`), the section for a known slug, `'invalid'`
 * for anything else (the screen redirects to the list). Slugs are lower-case only.
 */
export function parseSettingsSection(raw?: string): SettingsSectionId | null | 'invalid' {
  if (raw === undefined || raw === '') return null;
  return SECTION_IDS.includes(raw) ? (raw as SettingsSectionId) : 'invalid';
}

// ---- row summaries --------------------------------------------------------------------

/** «3 увімк.» … «1 увімк.», or «Вимкнено» when every reminder is off. */
export function remindersSummary(rem: Reminders): string {
  const on = REMINDER_ORDER.filter((kind) => rem[kind].on).length;
  return on > 0 ? `${on} увімк.` : 'Вимкнено';
}

/** «60 кг · 1 700 ккал», «60,5 кг · 1 650 ккал». */
export function goalsSummary(settings: Pick<Settings, 'goal' | 'kcalGoal'>): string {
  return `${fN(settings.goal)} кг · ${f0(settings.kcalGoal)} ккал`;
}

/** Built-in and her own types together: «7 типів», «8 типів», «21 тип», «22 типи». */
export function typesSummary(customTypes: readonly string[]): string {
  const n = normalizeTypeNames([...WORKOUT_TYPES, ...customTypes]).length;
  return `${n} ${plural(n, 'тип', 'типи', 'типів')}`;
}

/** The «Тренування» row of the list: «2 тренування» once she has workouts, else the count of types as before. */
export function workoutsRowSummary(workoutCount: number, typesText: string): string {
  return workoutCount > 0 ? `${workoutCount} ${plural(workoutCount, 'тренування', 'тренування', 'тренувань')}` : typesText;
}

/** Her meal types: «4 типи», «1 тип», «12 типів»; an empty list → «Немає типів». */
export function mealTypesSummary(mealTypes: readonly string[]): string {
  const n = normalizeTypeNames(mealTypes).length;
  return n > 0 ? `${n} ${plural(n, 'тип', 'типи', 'типів')}` : 'Немає типів';
}

/** «Авто» / «Світла» / «Темна». */
export function themeSummary(pref: ThemePref): string {
  return THEME_OPTIONS.find((o) => o.value === pref)?.label ?? 'Авто';
}

/** The «Акаунт» row: the username, «…» while it is not known yet (the legacy copy shown before `me`). */
export function accountSummary(user: Pick<SessionUser, 'username'> | null): string {
  return user?.username ?? '…';
}

/** «1 акаунт», «3 акаунти», «5 акаунтів». */
export function accountsCount(n: number): string {
  return `${n} ${plural(n, 'акаунт', 'акаунти', 'акаунтів')}`;
}

/** The «Користувачі» row: how many accounts there are, from the admin overview; nothing while it loads. */
export function usersSummary(overview: Pick<AdminOverview, 'users'> | null): string | undefined {
  return overview ? accountsCount(overview.users.length) : undefined;
}

/**
 * The short form of `syncStatus` for the «Дані і копія» row (same states, same tone for the dot):
 * «Синхронізовано», «Синхронізую…», «Очікує: 3», «Офлайн · 1 зміна», «Офлайн».
 */
export function syncShort(
  sync: Pick<SyncState, 'loaded' | 'online' | 'pending' | 'syncing'>,
): SyncStatusView {
  const { tone } = syncStatus(sync);
  const n = sync.pending;
  switch (tone) {
    case 'offline':
      return { text: n > 0 ? `Офлайн · ${n} ${plural(n, 'зміна', 'зміни', 'змін')}` : 'Офлайн', tone };
    case 'busy':
      return { text: 'Синхронізую…', tone };
    case 'pending':
      return { text: `Очікує: ${n}`, tone };
    case 'ok':
      return { text: 'Синхронізовано', tone };
  }
}

export interface NotifBadge {
  text: string;
  tone: Extract<PillTone, 'acc' | 'neutral'>;
}

const NOTIF_BADGES: Readonly<Record<Exclude<PushStatus, 'enabled'>, NotifBadge>> = {
  default: { text: 'Сповіщення вимкнені', tone: 'acc' },
  denied: { text: 'Сповіщення заборонені', tone: 'acc' },
  'needs-install': { text: 'Потрібне встановлення', tone: 'acc' },
  unsupported: { text: 'Сповіщення недоступні', tone: 'neutral' },
};

/**
 * The push problem shown under «Нагадування» (a small pill inside the row, so it is part of the link's name).
 * `null` when push works on this device, or while the status is still being checked.
 */
export function notifBadge(status: PushStatus | null): NotifBadge | null {
  if (status === null || status === 'enabled') return null;
  return NOTIF_BADGES[status];
}
