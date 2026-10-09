/**
 * View logic of the «Налаштування» sub-pages (port of the prototype's reminder/goal block in
 * `renderVals`, plus the settings we add on top). Pure functions only — the components wire
 * them to the store, push client and theme. The list's row summaries are in `listModel.ts`.
 */
import {
  appDataSchema,
  DOW_LONG,
  DOW_SHORT,
  f0,
  f1,
  GOAL_LIMITS,
  LIMITS,
  normalizeTypeNames,
  WEEK_ORDER,
  WORKOUT_TYPES,
  type AppData,
  type ReminderKind,
  type Reminders,
  type Settings,
  type Weekday,
} from '@legko/shared';
import { ApiError } from '@/lib/api';
import type { PushStatus } from '@/lib/push';
import type { ThemePref } from '@/lib/theme';
import type { SyncState } from '@/store/data';
import type { ConfirmOptions } from '@/store/ui';

// ---- reminders ------------------------------------------------------------------------

export const REMINDER_ORDER: readonly ReminderKind[] = ['workout', 'weigh', 'measure'];

export const REMINDER_TITLES: Record<ReminderKind, string> = {
  workout: 'Тренування',
  weigh: 'Контрольне зважування',
  measure: 'Заміри тіла',
};

/** Accessible names of the weekday pickers. */
export const REMINDER_DAYS_LABELS: Record<ReminderKind, string> = {
  workout: 'Дні тренувань',
  weigh: 'День зважування',
  measure: 'День замірів',
};

/** «Пн, Ср, Пт» (Monday first) or «Дні не вибрані». */
export function workoutDaysText(days: readonly Weekday[]): string {
  const picked = WEEK_ORDER.filter((d) => days.includes(d));
  return picked.length ? picked.map((d) => DOW_SHORT[d]).join(', ') : 'Дні не вибрані';
}

/** Card subtitle: «Пн, Ср, Пт · 18:00» for workouts, «Раз на тиждень · понеділок» for the weekly ones. */
export function reminderSubtitle(kind: ReminderKind, rem: Reminders): string {
  if (kind === 'workout') return `${workoutDaysText(rem.workout.days)} · ${rem.workout.time}`;
  return `Раз на тиждень · ${DOW_LONG[rem[kind].day]}`;
}

/** Settings with one reminder patched (immutable). */
export function withReminder<K extends ReminderKind>(
  settings: Settings,
  kind: K,
  patch: Partial<Reminders[K]>,
): Settings {
  const rem: Reminders = { ...settings.rem };
  rem[kind] = { ...settings.rem[kind], ...patch };
  return { ...settings, rem };
}

// ---- goals ----------------------------------------------------------------------------

export interface StepRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * One step up (`1`) or down (`-1`), rounded to 0.1. The range only stops a step from leaving it:
 * a value that is already outside (older data, a restored backup) moves one ordinary step
 * towards the range instead of jumping to the bound.
 */
export function stepValue(value: number, dir: 1 | -1, range: StepRange): number {
  const next = Math.round((value + dir * range.step) * 10) / 10;
  if (dir === 1) return value >= range.max ? value : Math.min(range.max, next);
  return value <= range.min ? value : Math.max(range.min, next);
}

export type GoalKey = 'goal' | 'kcalGoal';

export interface GoalRowModel {
  key: GoalKey;
  label: string;
  /** Formatted: «60,0 кг», «1 700 ккал». */
  value: string;
  decrementLabel: string;
  incrementLabel: string;
  canDecrement: boolean;
  canIncrement: boolean;
}

/** The same bounds as the first-run setup. */
const GOAL_RANGES: Record<GoalKey, StepRange> = { goal: GOAL_LIMITS.kg, kcalGoal: GOAL_LIMITS.kcal };

export function goalRows(settings: Settings): GoalRowModel[] {
  const row = (key: GoalKey, label: string, value: string, what: string): GoalRowModel => {
    const range = GOAL_RANGES[key];
    return {
      key,
      label,
      value,
      decrementLabel: `Зменшити ${what}`,
      incrementLabel: `Збільшити ${what}`,
      canDecrement: settings[key] > range.min,
      canIncrement: settings[key] < range.max,
    };
  };
  return [
    row('goal', 'Цільова вага', `${f1(settings.goal)} кг`, 'цільову вагу'),
    row('kcalGoal', 'Калорії на день', `${f0(settings.kcalGoal)} ккал`, 'калорії на день'),
  ];
}

/** Settings with the goal moved one step (immutable). */
export function stepGoal(settings: Settings, key: GoalKey, dir: 1 | -1): Settings {
  return { ...settings, [key]: stepValue(settings[key], dir, GOAL_RANGES[key]) };
}

// ---- notifications --------------------------------------------------------------------

/** What the CTA of the notifications panel does. */
export type NotifAction = 'enable' | 'test' | 'install' | null;

export interface NotifView {
  sub: string;
  cta: string;
  action: NotifAction;
  disabled: boolean;
  /** Offer «Вимкнути на цьому пристрої». */
  canTurnOff: boolean;
}

const NOTIF_COPY: Record<PushStatus, { sub: string; cta: string; action: NotifAction }> = {
  default: { sub: 'Дозволь Легко надсилати нагадування', cta: 'Увімкнути', action: 'enable' },
  enabled: { sub: 'Нагадування приходять, навіть коли застосунок закритий', cta: 'Тест', action: 'test' },
  'needs-install': {
    sub: 'На iPhone нагадування працюють, коли Легко додано на початковий екран',
    // As short as on the Home install banner: a long CTA squeezes the title onto two lines.
    cta: 'Як?',
    action: 'install',
  },
  denied: {
    sub: 'Сповіщення заборонені. Увімкни їх у Параметрах → Сповіщення → Легко',
    cta: 'Заблоковано',
    action: null,
  },
  unsupported: { sub: 'Цей браузер не підтримує сповіщення', cta: 'Недоступно', action: null },
};

/** `status` is `null` while it is still being checked; `busy` while an action is running. */
export function notifView(status: PushStatus | null, busy = false): NotifView {
  if (status === null) {
    return { sub: 'Перевіряю сповіщення…', cta: '…', action: null, disabled: true, canTurnOff: false };
  }
  const copy = NOTIF_COPY[status];
  return {
    sub: copy.sub,
    cta: busy ? '…' : copy.cta,
    action: copy.action,
    disabled: busy || copy.action === null,
    canTurnOff: status === 'enabled',
  };
}

export const NOTIF_TOASTS = {
  enabled: 'Сповіщення увімкнено',
  denied: 'Сповіщення заборонені — їх можна дозволити в Параметрах',
  enableFailed: 'Не вдалося увімкнути сповіщення. Спробуй ще раз',
  testSent: 'Надіслано — перевір сповіщення',
  testNobody: 'Сервер не знайшов жодного пристрою — увімкни сповіщення ще раз',
  testFailed: 'Не вдалося надіслати тест. Спробуй ще раз',
  disabled: 'Сповіщення на цьому пристрої вимкнено',
  disableFailed: 'Не вдалося вимкнути сповіщення',
} as const;

/**
 * Ukrainian text for a failed request: the server's own message (already Ukrainian) for API
 * errors, otherwise `fallback` (DOMExceptions from the push service, timeouts, proxy pages…).
 */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code !== 'internal' && err.message) return err.message;
  return fallback;
}

// ---- custom workout types -------------------------------------------------------------

export type AddTypeResult = { ok: true; name: string; types: string[] } | { ok: false; error: string };

/** Validates a new custom workout type against the built-in and existing custom ones. */
export function addCustomType(custom: readonly string[], raw: string): AddTypeResult {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Введи назву тренування' };
  if (name.length > LIMITS.typeName)
    return { ok: false, error: `Назва задовга — до ${LIMITS.typeName} символів` };
  const key = name.toLocaleLowerCase('uk');
  const existing = [...WORKOUT_TYPES, ...custom].find((t) => t.toLocaleLowerCase('uk') === key);
  if (existing) return { ok: false, error: `«${existing}» вже є у списку` };
  if (custom.length >= LIMITS.customTypes) {
    return { ok: false, error: `Можна додати до ${LIMITS.customTypes} своїх типів` };
  }
  return { ok: true, name, types: normalizeTypeNames([...custom, name]) };
}

export function removeCustomType(custom: readonly string[], name: string): string[] {
  return custom.filter((t) => t !== name);
}

// ---- appearance -----------------------------------------------------------------------

export const THEME_OPTIONS: readonly { value: ThemePref; label: string }[] = [
  { value: 'auto', label: 'Авто' },
  { value: 'light', label: 'Світла' },
  { value: 'dark', label: 'Темна' },
];

// ---- data & sync ----------------------------------------------------------------------

/** Ukrainian plural: 1 зміна, 2 зміни, 5 змін, 21 зміна, 11 змін. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

/** Colour of the sync dot: `ok` mint, `busy` / `pending` lavender, `offline` faint. */
export type SyncTone = 'ok' | 'busy' | 'pending' | 'offline';

export interface SyncStatusView {
  text: string;
  tone: SyncTone;
}

/** The full status line of the «Дані» card («Офлайн — 1 зміна чекає на інтернет»); `syncShort` is the row form. */
export function syncStatus(
  sync: Pick<SyncState, 'loaded' | 'online' | 'pending' | 'syncing'>,
): SyncStatusView {
  const n = sync.pending;
  if (!sync.online && n > 0) {
    return {
      text: `Офлайн — ${n} ${plural(n, 'зміна чекає', 'зміни чекають', 'змін чекають')} на інтернет`,
      tone: 'offline',
    };
  }
  if (!sync.online) return { text: 'Офлайн — нових змін немає', tone: 'offline' };
  if (sync.syncing || !sync.loaded) return { text: 'Синхронізую…', tone: 'busy' };
  if (n > 0) return { text: `Очікує синхронізації: ${n}`, tone: 'pending' };
  return { text: 'Усе синхронізовано', tone: 'ok' };
}

export const BACKUP_COPY = {
  restored: 'Дані відновлено',
  invalid: 'Файл не схожий на резервну копію «Легко»',
  tooLarge: 'Файл завеликий для резервної копії',
  restoreFailed: 'Не вдалося відновити дані. Спробуй ще раз',
  offline: 'Немає інтернету — копію можна завантажити, коли зʼявиться звʼязок',
  notSynced: 'Не всі зміни встигли синхронізуватися — спробуй ще раз пізніше',
  /** iOS refused the share sheet after the sync wait: it needs a fresh tap. */
  tapAgain: 'Копія готова — натисни ще раз, щоб зберегти',
  shareFailed: 'Не вдалося зберегти копію. Спробуй ще раз',
  /** Installed iPhone app on an iOS that cannot share files (a download link would trap the app). */
  safariOnly: 'На цьому iPhone копію можна завантажити лише в Safari',
} as const;

/** Asked before a backup replaces everything. */
export const RESTORE_CONFIRM = {
  title: 'Відновити з резервної копії?',
  body: 'Усі поточні записи буде замінено даними з файлу.',
  confirmLabel: 'Відновити',
  destructive: true,
} as const satisfies ConfirmOptions;

/** Backups are a few MB at most; anything much bigger is not one of ours. */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

/** Parses and validates a backup file's text; `null` when it is not a valid «Легко» backup. */
export function parseBackup(text: string): AppData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = appDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
