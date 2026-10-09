import { defaultReminders, defaultSettings, LIMITS, type ReminderKind, type Reminders } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { PushStatus } from '@/lib/push';
import { ICON_PATHS } from '@/ui';
import {
  DESKTOP_DEFAULT_SECTION,
  goalsSummary,
  notifBadge,
  parseSettingsSection,
  remindersSummary,
  SECTION_ICONS,
  SECTION_TITLES,
  SETTINGS_GROUPS,
  SETTINGS_ROOT,
  settingsPath,
  syncShort,
  themeSummary,
  typesSummary,
  type SettingsSectionId,
} from './listModel';
import { syncStatus, withReminder } from './model';

/** `f0` groups thousands with a (narrow) no-break space, which `\s` matches; compare with plain spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ');

const ALL: SettingsSectionId[] = ['reminders', 'goals', 'workouts', 'appearance', 'data'];

describe('sections & routes', () => {
  it('has one route, title and icon per section, in two groups', () => {
    expect(SETTINGS_ROOT).toBe('/settings');
    expect(ALL.map(settingsPath)).toEqual([
      '/settings/reminders',
      '/settings/goals',
      '/settings/workouts',
      '/settings/appearance',
      '/settings/data',
    ]);
    expect(SECTION_TITLES).toEqual({
      reminders: 'Нагадування',
      goals: 'Цілі',
      workouts: 'Типи тренувань',
      appearance: 'Вигляд',
      data: 'Дані і копія',
    });
    expect(SECTION_ICONS).toEqual({
      reminders: { icon: 'bell', tone: 'acc' },
      goals: { icon: 'target', tone: 'acc2' },
      workouts: { icon: 'workout', tone: 'acc' },
      appearance: { icon: 'theme', tone: 'neutral' },
      data: { icon: 'data', tone: 'acc2' },
    });
    for (const id of ALL) expect(ICON_PATHS[SECTION_ICONS[id].icon]).toBeTruthy();
    expect(SETTINGS_GROUPS).toEqual([
      ['reminders', 'goals', 'workouts'],
      ['appearance', 'data'],
    ]);
    expect(DESKTOP_DEFAULT_SECTION).toBe('reminders');
  });

  it('parses the :section param', () => {
    expect(parseSettingsSection(undefined)).toBeNull();
    expect(parseSettingsSection('')).toBeNull();
    for (const id of ALL) expect(parseSettingsSection(id)).toBe(id);
    expect(parseSettingsSection('foo')).toBe('invalid');
    expect(parseSettingsSection('Reminders')).toBe('invalid');
    expect(parseSettingsSection('types')).toBe('invalid');
  });
});

describe('row summaries', () => {
  it('counts the reminders that are on', () => {
    const off = (...kinds: ReminderKind[]): Reminders =>
      kinds.reduce((st, kind) => withReminder(st, kind, { on: false }), defaultSettings()).rem;
    expect(remindersSummary(defaultReminders())).toBe('3 увімк.');
    expect(remindersSummary(off('measure'))).toBe('2 увімк.');
    expect(remindersSummary(off('workout', 'weigh'))).toBe('1 увімк.');
    expect(remindersSummary(off('workout', 'weigh', 'measure'))).toBe('Вимкнено');
  });

  it('formats the goals without a needless «,0» (NBSP-tolerant)', () => {
    expect(plain(goalsSummary(defaultSettings()))).toBe('60 кг · 1 700 ккал');
    expect(plain(goalsSummary({ goal: 60.5, kcalGoal: 1650 }))).toBe('60,5 кг · 1 650 ккал');
    expect(plain(goalsSummary({ goal: 72.25, kcalGoal: 900 }))).toBe('72,3 кг · 900 ккал');
  });

  it('counts built-in and own workout types with Ukrainian plurals', () => {
    const own = (n: number) => Array.from({ length: n }, (_, i) => `Свій ${i + 1}`);
    expect(typesSummary([])).toBe('7 типів');
    expect(typesSummary(['Йога'])).toBe('8 типів');
    // Duplicates of a built-in type (any case) are not counted twice.
    expect(typesSummary(['кардіо', 'Йога', 'йога'])).toBe('8 типів');
    expect(typesSummary(own(14))).toBe('21 тип');
    expect(typesSummary(own(15))).toBe('22 типи');
    expect(typesSummary(own(18))).toBe('25 типів');
    expect(typesSummary(own(LIMITS.customTypes))).toBe('37 типів');
  });

  it('names the theme', () => {
    expect(themeSummary('auto')).toBe('Авто');
    expect(themeSummary('light')).toBe('Світла');
    expect(themeSummary('dark')).toBe('Темна');
  });

  describe('sync', () => {
    const base = { loaded: true, online: true, pending: 0, syncing: false };

    it('shortens every state and keeps the dot tone of the full status', () => {
      const cases = [
        [base, 'Синхронізовано', 'ok'],
        [{ ...base, syncing: true }, 'Синхронізую…', 'busy'],
        [{ ...base, loaded: false }, 'Синхронізую…', 'busy'],
        [{ ...base, pending: 3 }, 'Очікує: 3', 'pending'],
        [{ ...base, online: false }, 'Офлайн', 'offline'],
        [{ ...base, online: false, pending: 1, syncing: true }, 'Офлайн · 1 зміна', 'offline'],
      ] as const;
      for (const [sync, text, tone] of cases) {
        expect(syncShort(sync)).toEqual({ text, tone });
        expect(syncShort(sync).tone).toBe(syncStatus(sync).tone);
      }
    });

    it('uses Ukrainian plurals offline (1 / 2 / 5 / 21)', () => {
      const offline = (pending: number) => syncShort({ ...base, online: false, pending }).text;
      expect(offline(1)).toBe('Офлайн · 1 зміна');
      expect(offline(2)).toBe('Офлайн · 2 зміни');
      expect(offline(5)).toBe('Офлайн · 5 змін');
      expect(offline(11)).toBe('Офлайн · 11 змін');
      expect(offline(21)).toBe('Офлайн · 21 зміна');
    });
  });

  it('shows a push problem badge for every status but «enabled» and «still checking»', () => {
    const cases: [PushStatus | null, ReturnType<typeof notifBadge>][] = [
      ['default', { text: 'Сповіщення вимкнені', tone: 'acc' }],
      ['denied', { text: 'Сповіщення заборонені', tone: 'acc' }],
      ['needs-install', { text: 'Потрібне встановлення', tone: 'acc' }],
      ['unsupported', { text: 'Сповіщення недоступні', tone: 'neutral' }],
      ['enabled', null],
      [null, null],
    ];
    for (const [status, badge] of cases) expect(notifBadge(status), String(status)).toEqual(badge);
  });
});
