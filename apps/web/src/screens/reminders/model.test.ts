import { defaultReminders, defaultSettings, emptyData, f0, GOAL_LIMITS, LIMITS, type Settings } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  addCustomType,
  errorText,
  goalRows,
  notifView,
  parseBackup,
  plural,
  reminderSubtitle,
  removeCustomType,
  stepGoal,
  stepValue,
  syncStatus,
  withReminder,
  workoutDaysText,
} from './model';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...patch });

describe('reminder copy', () => {
  it('lists workout days Monday first, like the prototype', () => {
    expect(workoutDaysText([5, 1, 3])).toBe('Пн, Ср, Пт');
    expect(workoutDaysText([0, 6, 1])).toBe('Пн, Сб, Нд');
    expect(workoutDaysText([])).toBe('Дні не вибрані');
  });

  it('builds the card subtitles', () => {
    const rem = defaultReminders();
    expect(reminderSubtitle('workout', rem)).toBe('Пн, Ср, Пт · 18:00');
    expect(reminderSubtitle('weigh', rem)).toBe('Раз на тиждень · понеділок');
    const custom = withReminder(settings(), 'measure', { day: 5 }).rem;
    expect(reminderSubtitle('measure', custom)).toBe('Раз на тиждень · пʼятниця');
    const none = withReminder(settings(), 'workout', { days: [], time: '07:30' }).rem;
    expect(reminderSubtitle('workout', none)).toBe('Дні не вибрані · 07:30');
  });

  it('patches one reminder without touching the others', () => {
    const before = settings();
    const after = withReminder(before, 'weigh', { on: false, time: '09:15' });
    expect(after.rem.weigh).toEqual({ on: false, day: 1, time: '09:15' });
    expect(after.rem.workout).toBe(before.rem.workout);
    expect(before.rem.weigh.on).toBe(true);
  });
});

describe('goals', () => {
  const KG = GOAL_LIMITS.kg;
  const KCAL = GOAL_LIMITS.kcal;

  it('steps and clamps to the shared goal limits', () => {
    expect(KG).toEqual({ min: 30, max: 200, step: 0.5 });
    expect(KCAL).toEqual({ min: 800, max: 5000, step: 50 });
    expect(stepValue(60, 1, KG)).toBe(60.5);
    expect(stepValue(60.1, 1, KG)).toBe(60.6);
    expect(stepValue(30, -1, KG)).toBe(30);
    expect(stepValue(199.8, 1, KG)).toBe(200);
    expect(stepValue(30.2, -1, KG)).toBe(30);
    expect(stepValue(1700, -1, KCAL)).toBe(1650);
    expect(stepValue(800, -1, KCAL)).toBe(800);
    expect(stepValue(5000, 1, KCAL)).toBe(5000);
  });

  it('moves a value from outside the limits one ordinary step towards them, never jumping', () => {
    expect(stepValue(25, 1, KG)).toBe(25.5);
    expect(stepValue(25, -1, KG)).toBe(25);
    expect(stepValue(250, -1, KG)).toBe(249.5);
    expect(stepValue(250, 1, KG)).toBe(250);
    expect(stepValue(6000, -1, KCAL)).toBe(5950);
    expect(stepValue(6000, 1, KCAL)).toBe(6000);
    expect(stepValue(500, 1, KCAL)).toBe(550);
    expect(stepValue(500, -1, KCAL)).toBe(500);
  });

  it('formats the rows like the prototype', () => {
    const [kg, kcal] = goalRows(settings());
    expect(kg).toMatchObject({ label: 'Цільова вага', value: '60,0 кг', canDecrement: true, canIncrement: true });
    expect(kcal).toMatchObject({ label: 'Калорії на день', value: `${f0(1700)} ккал` });
    expect(kcal?.value.replace(/\s/g, ' ')).toBe('1 700 ккал');
    expect(kg?.decrementLabel).toBe('Зменшити цільову вагу');
  });

  it('disables the buttons at the limits', () => {
    const [kg, kcal] = goalRows(settings({ goal: 30, kcalGoal: 5000 }));
    expect(kg?.canDecrement).toBe(false);
    expect(kg?.canIncrement).toBe(true);
    expect(kcal?.canIncrement).toBe(false);
  });

  it('offers only the way back into the limits for a goal outside them', () => {
    const outside = settings({ goal: 25, kcalGoal: 6000 });
    const [kg, kcal] = goalRows(outside);
    expect(kg).toMatchObject({ canDecrement: false, canIncrement: true });
    expect(kcal).toMatchObject({ canDecrement: true, canIncrement: false });
    expect(stepGoal(outside, 'kcalGoal', -1).kcalGoal).toBe(5950);
    expect(stepGoal(outside, 'goal', 1).goal).toBe(25.5);
  });

  it('updates settings immutably', () => {
    const before = settings();
    expect(stepGoal(before, 'goal', -1).goal).toBe(59.5);
    expect(stepGoal(before, 'kcalGoal', 1).kcalGoal).toBe(1750);
    expect(before.goal).toBe(60);
  });
});

describe('notifications panel', () => {
  it('maps every push status to copy and an action', () => {
    expect(notifView('default')).toEqual({
      sub: 'Дозволь Легко надсилати нагадування',
      cta: 'Увімкнути',
      action: 'enable',
      disabled: false,
      canTurnOff: false,
    });
    expect(notifView('enabled')).toMatchObject({
      sub: 'Нагадування приходять, навіть коли застосунок закритий',
      cta: 'Тест',
      action: 'test',
      canTurnOff: true,
    });
    expect(notifView('needs-install')).toMatchObject({
      sub: 'На iPhone нагадування працюють, коли Легко додано на початковий екран',
      cta: 'Як?',
      action: 'install',
      disabled: false,
    });
    expect(notifView('denied')).toMatchObject({
      sub: 'Сповіщення заборонені. Увімкни їх у Параметрах → Сповіщення → Легко',
      cta: 'Заблоковано',
      disabled: true,
    });
    expect(notifView('unsupported')).toMatchObject({
      sub: 'Цей браузер не підтримує сповіщення',
      cta: 'Недоступно',
      disabled: true,
    });
  });

  it('shows a disabled «…» while loading or busy', () => {
    expect(notifView(null)).toMatchObject({ cta: '…', disabled: true, action: null });
    expect(notifView('enabled', true)).toMatchObject({ cta: '…', disabled: true, action: 'test' });
  });

  it('uses the server message for API errors and a fallback otherwise', () => {
    expect(errorText(new ApiError(503, 'push_unavailable', 'Сповіщення недоступні на сервері'), 'x')).toBe(
      'Сповіщення недоступні на сервері',
    );
    expect(errorText(new ApiError(0, 'network', 'Немає зʼєднання з сервером'), 'x')).toBe(
      'Немає зʼєднання з сервером',
    );
    expect(errorText(new ApiError(502, 'internal', 'Bad Gateway'), 'запасний')).toBe('запасний');
    expect(errorText(new DOMException('push service error', 'AbortError'), 'запасний')).toBe('запасний');
  });
});

describe('custom workout types', () => {
  it('adds a trimmed name', () => {
    expect(addCustomType([], '  Йога   вдома ')).toEqual({ ok: true, name: 'Йога вдома', types: ['Йога вдома'] });
    expect(addCustomType(['Плавання'], 'Йога')).toMatchObject({ ok: true, types: ['Плавання', 'Йога'] });
  });

  it('refuses empty, too long, duplicate and over-limit names', () => {
    expect(addCustomType([], '   ')).toEqual({ ok: false, error: 'Введи назву тренування' });
    expect(addCustomType([], 'я'.repeat(LIMITS.typeName + 1))).toEqual({
      ok: false,
      error: 'Назва задовга — до 40 символів',
    });
    expect(addCustomType([], 'кардіо')).toEqual({ ok: false, error: '«Кардіо» вже є у списку' });
    expect(addCustomType(['Йога'], 'ЙОГА')).toEqual({ ok: false, error: '«Йога» вже є у списку' });
    const full = Array.from({ length: LIMITS.customTypes }, (_, i) => `Тип ${i}`);
    expect(addCustomType(full, 'Ще один')).toEqual({ ok: false, error: 'Можна додати до 30 своїх типів' });
  });

  it('removes by exact name', () => {
    expect(removeCustomType(['Йога', 'Плавання'], 'Йога')).toEqual(['Плавання']);
  });
});

describe('sync status', () => {
  const base = { loaded: true, online: true, pending: 0, syncing: false };

  it('picks the line for each state', () => {
    expect(syncStatus(base)).toEqual({ text: 'Усе синхронізовано', tone: 'ok' });
    expect(syncStatus({ ...base, syncing: true, pending: 2 })).toEqual({ text: 'Синхронізую…', tone: 'busy' });
    expect(syncStatus({ ...base, pending: 3 })).toEqual({ text: 'Очікує синхронізації: 3', tone: 'pending' });
    expect(syncStatus({ ...base, online: false, pending: 5 }).text).toBe('Офлайн — 5 змін чекають на інтернет');
    expect(syncStatus({ ...base, online: false, pending: 1 }).text).toBe('Офлайн — 1 зміна чекає на інтернет');
    expect(syncStatus({ ...base, online: false, pending: 3 }).text).toBe('Офлайн — 3 зміни чекають на інтернет');
    expect(syncStatus({ ...base, online: false })).toEqual({ text: 'Офлайн — нових змін немає', tone: 'offline' });
  });

  it('uses Ukrainian plural forms', () => {
    const forms = (n: number) => plural(n, 'one', 'few', 'many');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(forms)).toEqual([
      'one',
      'few',
      'few',
      'many',
      'many',
      'many',
      'many',
      'one',
      'few',
      'many',
      'one',
      'many',
    ]);
  });
});

describe('parseBackup', () => {
  it('accepts an export file', () => {
    const data = { ...emptyData(), weights: [{ date: '2026-10-05', kg: 65.4 }] };
    expect(parseBackup(JSON.stringify(data))?.weights).toEqual([{ date: '2026-10-05', kg: 65.4 }]);
  });

  it('accepts backups made before «Часті страви» existed', () => {
    const { foods: _foods, ...old } = emptyData();
    expect(parseBackup(JSON.stringify(old))?.foods).toEqual([]);
  });

  it('rejects other files', () => {
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup('{"hello":"world"}')).toBeNull();
    expect(parseBackup(JSON.stringify({ ...emptyData(), settings: { goal: 'x' } }))).toBeNull();
  });
});
