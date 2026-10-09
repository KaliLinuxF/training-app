import { emptyData, f0, type AppData, type DayEntry } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { buildHomeModel, markNoTraining, QUICK_ACTIONS, type HomeModelOptions } from './homeModel';

/** 2026-10-12 is a Monday: the default weigh-in, measurements and a workout are all due. */
const MONDAY = '2026-10-12';
const SATURDAY = '2026-10-10';
/** «1 650» with the locale's own (non-breaking) group separator. */
const KCAL_1650 = f0(1650);
const MORNING: HomeModelOptions = { now: new Date(2026, 9, 12, 9, 15), online: true, showInstallHint: false };

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

/** Every string in a model (what ends up on screen). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

function onboarded(patch: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return { ...base, settings: { ...base.settings, onboarded: true }, ...patch };
}

/** Three weekly weigh-ins (68,4 → 65,4, the last one today), partial measurements, today filled in. */
function sample(): AppData {
  return onboarded({
    weights: [
      { date: '2026-09-28', kg: 68.4 },
      { date: '2026-10-05', kg: 67 },
      { date: MONDAY, kg: 65.4 },
    ],
    measures: [
      { date: '2026-09-28', chest: 93, waist: 74.5, hips: 101 },
      { date: '2026-10-05', chest: null, waist: 73, hips: null },
    ],
    days: {
      '2026-10-05': day({ food: 'Омлет', kcal: 1500, trained: true, types: ['Верх тіла'] }),
      [MONDAY]: day({ food: 'Вівсянка з бананом', kcal: 1650, trained: true, types: ['Кардіо', 'Прес'] }),
    },
  });
}

describe('buildHomeModel — empty data (new user)', () => {
  const model = buildHomeModel(emptyData(), MONDAY, MORNING);

  it('never shows NaN, undefined or null', () => {
    const texts = stringsOf(model);
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) expect(text).not.toMatch(/NaN|undefined|null|Infinity/);
    expect(Number.isFinite(model.hero.pct)).toBe(true);
  });

  it('shows the header', () => {
    expect(model.todayLabel).toBe('Понеділок, 12 жовтня');
    expect(model.greeting).toBe('Доброго ранку');
    expect(model.offline).toBe(false);
  });

  it('shows only the first-run banner until setup is done (no wall of reminder banners)', () => {
    expect(model.banners.map((b) => b.id)).toEqual(['setup']);
    expect(model.banners[0]).toEqual({
      id: 'setup',
      title: 'Почнімо',
      sub: 'Запиши стартову вагу й ціль — прогрес рахуватиметься сам',
      cta: 'Налаштувати',
      action: { mode: 'setup' },
      dismissible: false,
    });
  });

  it('shows dashes in the hero and an empty bar', () => {
    expect(model.hero).toEqual({
      current: '—',
      badge: '— кг',
      pct: 0,
      pctLabel: '0%',
      start: '—',
      goal: '60,0',
      lost: '— кг',
      left: '— кг',
    });
  });

  it('shows an unmarked day', () => {
    expect(model.today).toEqual({
      food: 'Не записано',
      kcal: '—',
      trained: null,
      training: 'ще не відмічено',
    });
  });

  it('shows the week tiles with dashes', () => {
    expect(model.week.map((t) => [t.label, t.value, t.unit, t.tone])).toEqual([
      ['Тренувань', '0', 'з 3', 'flat'],
      ['Сер. калорії', '—', 'ккал', 'flat'],
      ['Зміна ваги', '—', 'кг', 'flat'],
      ['Талія', '—', 'см', 'flat'],
    ]);
  });

  it('shows empty measurements', () => {
    expect(model.measures).toEqual({
      date: 'ще немає',
      tiles: [
        { key: 'chest', label: 'Груди', value: '—', delta: '—', hasDelta: false },
        { key: 'waist', label: 'Талія', value: '—', delta: '—', hasDelta: false },
        { key: 'hips', label: 'Стегна', value: '—', delta: '—', hasDelta: false },
      ],
    });
  });

  it('shows the control rows', () => {
    expect(model.control).toEqual([
      { label: 'Останнє зважування', value: '—' },
      { label: 'Наступне зважування', value: 'Сьогодні · 08:00' },
      { label: 'Наступні заміри', value: 'Сьогодні · 08:30' },
    ]);
  });
});

describe('buildHomeModel — with data', () => {
  const model = buildHomeModel(sample(), MONDAY, MORNING);

  it('fills the hero from the weigh-ins', () => {
    expect(model.hero).toEqual({
      current: '65,4',
      badge: '−3,0 кг',
      pct: expect.closeTo((3 / 8.4) * 100, 6),
      pctLabel: '36%',
      start: '68,4',
      goal: '60,0',
      lost: '3,0 кг',
      left: '5,4 кг',
    });
  });

  it('drops the banners whose action is done today', () => {
    // Weighed and trained today; only the measurements are still due.
    expect(model.banners.map((b) => [b.id, b.title, b.sub, b.cta, b.action])).toEqual([
      ['measure', 'Заміри тіла', 'Сьогодні о 08:30', 'Записати', { mode: 'measure' }],
    ]);
  });

  it('summarises today', () => {
    expect(model.today).toEqual({
      food: 'Записано',
      kcal: `${KCAL_1650} ккал`,
      trained: true,
      training: 'Кардіо, Прес',
    });
  });

  it('computes this week from Monday, against the last value before it', () => {
    expect(model.week.map((t) => [t.value, t.unit, t.tone])).toEqual([
      ['1', 'з 3', 'flat'],
      [KCAL_1650, 'ккал', 'flat'],
      ['−1,6', 'кг', 'down'],
      ['—', 'см', 'flat'],
    ]);
  });

  it('shows the latest value of each measurement and its change since the first one', () => {
    expect(model.measures).toEqual({
      date: '5 жовтня',
      tiles: [
        { key: 'chest', label: 'Груди', value: '93', delta: '0 см', hasDelta: true },
        { key: 'waist', label: 'Талія', value: '73', delta: '−1,5 см', hasDelta: true },
        { key: 'hips', label: 'Стегна', value: '101', delta: '0 см', hasDelta: true },
      ],
    });
  });

  it('shows the last weigh-in and skips today for the next one once done', () => {
    expect(model.control.map((r) => r.value)).toEqual([
      '12 жовтня — 65,4 кг',
      'Пн, 19 жовтня · 08:00',
      'Сьогодні · 08:30',
    ]);
  });
});

describe('buildHomeModel — details', () => {
  it('uses the prototype reminder copy for each due banner', () => {
    const banners = buildHomeModel(onboarded(), MONDAY, MORNING).banners;
    expect(banners.map((b) => [b.title, b.sub, b.cta, b.action])).toEqual([
      ['Контрольне зважування', 'Сьогодні о 08:00', 'Записати', { mode: 'weight' }],
      ['Заміри тіла', 'Сьогодні о 08:30', 'Записати', { mode: 'measure' }],
      [
        'Тренування за планом',
        'Сьогодні о 18:00 — відміть, як пройде',
        'Відмітити',
        { mode: 'day', patch: { trained: true } },
      ],
    ]);
  });

  it('puts the install hint last and makes it dismissible', () => {
    const banners = buildHomeModel(onboarded(), MONDAY, { ...MORNING, showInstallHint: true }).banners;
    expect(banners.map((b) => b.id)).toEqual(['weigh', 'measure', 'workout', 'install']);
    const first = buildHomeModel(emptyData(), MONDAY, { ...MORNING, showInstallHint: true }).banners;
    expect(first.map((b) => b.id)).toEqual(['setup', 'install']);
    expect(banners.at(-1)).toEqual({
      id: 'install',
      title: 'Встанови Легко на iPhone',
      sub: 'Так працюватимуть нагадування',
      cta: 'Як?',
      action: { mode: 'install' },
      dismissible: true,
    });
  });

  it('has no banners on a day without reminders', () => {
    expect(buildHomeModel(onboarded(), SATURDAY, MORNING).banners).toEqual([]);
    expect(buildHomeModel(onboarded(), SATURDAY, MORNING).todayLabel).toBe('Субота, 10 жовтня');
  });

  it('flags offline', () => {
    expect(buildHomeModel(onboarded(), MONDAY, { ...MORNING, online: false }).offline).toBe(true);
  });

  it.each([
    [8, 'Доброго ранку'],
    [12, 'Доброго дня'],
    [17, 'Доброго дня'],
    [18, 'Доброго вечора'],
  ])('greets at %i:00 with «%s»', (hour, text) => {
    const now = new Date(2026, 9, 12, hour, 0);
    expect(buildHomeModel(onboarded(), MONDAY, { ...MORNING, now }).greeting).toBe(text);
  });

  it.each([
    [day({ trained: true }), true, 'Було'],
    [day({ trained: false }), false, 'Не було'],
    [day({ food: 'Борщ' }), null, 'ще не відмічено'],
  ])('labels the workout mark', (entry, trained, label) => {
    const today = buildHomeModel(onboarded({ days: { [MONDAY]: entry } }), MONDAY, MORNING).today;
    expect(today.trained).toBe(trained);
    expect(today.training).toBe(label);
  });

  it('counts a food photo as recorded food', () => {
    const data = onboarded({ days: { [MONDAY]: day({ photos: ['p1'] }) } });
    expect(buildHomeModel(data, MONDAY, MORNING).today.food).toBe('Записано');
  });

  it('shows a weight gain with signs instead of a negative «lost»', () => {
    const data = onboarded({
      weights: [
        { date: '2026-10-05', kg: 60 },
        { date: MONDAY, kg: 61 },
      ],
    });
    const hero = buildHomeModel(data, MONDAY, MORNING).hero;
    expect(hero).toMatchObject({ badge: '+1,0 кг', lost: '−1,0 кг', left: '1,0 кг', pct: 0, pctLabel: '0%' });
  });

  it('keeps a full bar once the goal is reached', () => {
    const data = onboarded({
      weights: [
        { date: '2026-10-05', kg: 64 },
        { date: MONDAY, kg: 59.5 },
      ],
    });
    expect(buildHomeModel(data, MONDAY, MORNING).hero).toMatchObject({
      pct: 100,
      pctLabel: '100%',
      left: '0,0 кг',
      badge: '−4,5 кг',
    });
  });

  it('shows «вимкнено» and no banners when the reminders are off', () => {
    const base = onboarded();
    const off = { ...base.settings.rem.weigh, on: false };
    const data: AppData = {
      ...base,
      settings: {
        ...base.settings,
        rem: {
          workout: { ...base.settings.rem.workout, on: false, days: [] },
          weigh: off,
          measure: { ...base.settings.rem.measure, on: false },
        },
      },
    };
    const model = buildHomeModel(data, MONDAY, MORNING);
    expect(model.banners).toEqual([]);
    expect(model.control.slice(1).map((r) => r.value)).toEqual(['вимкнено', 'вимкнено']);
    // No planned workout days: «з 0» would read oddly, so the unit is left out.
    expect(model.week[0]).toMatchObject({ value: '0', unit: undefined });
  });

  it('colours a waist increase lavender', () => {
    const data = onboarded({
      measures: [
        { date: '2026-10-05', chest: null, waist: 70, hips: null },
        { date: MONDAY, chest: null, waist: 70.5, hips: null },
      ],
    });
    expect(buildHomeModel(data, MONDAY, MORNING).week[3]).toMatchObject({ value: '+0,5', tone: 'up' });
  });
});

describe('markNoTraining', () => {
  it('creates a day marked «no workout»', () => {
    expect(markNoTraining(undefined)).toEqual(day({ trained: false }));
  });

  it('keeps everything else of the day', () => {
    const entry = day({
      food: 'Борщ',
      kcal: 1400,
      trained: true,
      types: ['Кардіо'],
      notes: 'Втома',
      photos: ['a', 'b'],
    });
    expect(markNoTraining(entry)).toEqual({ ...entry, trained: false, types: [] });
  });
});

describe('QUICK_ACTIONS', () => {
  it('opens the day, day + workout, weight and measurement sheets', () => {
    expect(QUICK_ACTIONS.map((q) => [q.label, q.tone, q.action])).toEqual([
      ['Харчування', 'acc2', { mode: 'day' }],
      ['Тренування', 'acc', { mode: 'day', patch: { trained: true } }],
      ['Вага', 'neutral', { mode: 'weight' }],
      ['Заміри', 'neutral', { mode: 'measure' }],
    ]);
  });
});
