import {
  emptyData,
  f0,
  type AppData,
  type DayEntry,
  type MeasureEntry,
  type Weekday,
  type WeeklyReminder,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  buildHomeModel,
  HOME_ROW_ACTIONS,
  OFFLINE_NOTE,
  type HomeModel,
  type HomeModelOptions,
} from './homeModel';

/** 2026-10-12 is a Monday: the default weigh-in, measurements and a workout are all scheduled. */
const MONDAY = '2026-10-12';
const TUESDAY = '2026-10-13';
const WEDNESDAY = '2026-10-14';
const MORNING: HomeModelOptions = { now: new Date(2026, 9, 12, 9, 15), online: true, showInstallHint: false };

/** Locale group separators (NBSP / narrow NBSP) → plain spaces, for readable expectations. */
const nb = (text: string | null | undefined): string | null | undefined => text?.replace(/\s/g, ' ');
/** No-break space (U+00A0), for the raw week-row assertions. */
const NB = String.fromCharCode(0xa0);

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

const measure = (
  date: string,
  chest: number | null,
  waist: number | null,
  hips: number | null,
): MeasureEntry => ({
  date,
  chest,
  waist,
  hips,
});

/** Every string in a model (what ends up on screen or in an accessible name). */
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

/** `data` with the weigh-in / measurement reminders replaced. */
function withRem(data: AppData, rem: { weigh?: WeeklyReminder; measure?: WeeklyReminder }): AppData {
  return { ...data, settings: { ...data.settings, rem: { ...data.settings.rem, ...rem } } };
}

const weekly = (weekday: number, on = true, time = '08:00'): WeeklyReminder => ({
  on,
  day: weekday as Weekday,
  time,
});

/** Three weekly weigh-ins (68,4 → 65,4) and partial measurements; nothing recorded on Wednesday yet. */
function sample(): AppData {
  return onboarded({
    weights: [
      { date: '2026-09-28', kg: 68.4 },
      { date: '2026-10-05', kg: 67 },
      { date: MONDAY, kg: 65.4 },
    ],
    measures: [measure('2026-09-28', 93, 74.5, 101), measure('2026-10-05', null, 73, null)],
    days: {
      '2026-10-05': day({ food: 'Омлет', kcal: 1500, trained: true, types: ['Верх тіла'] }),
      [MONDAY]: day({ food: 'Вівсянка з бананом', kcal: 1650, trained: true, types: ['Кардіо', 'Прес'] }),
    },
  });
}

const model = (data: AppData, today = MONDAY, opts: Partial<HomeModelOptions> = {}): HomeModel =>
  buildHomeModel(data, today, { ...MORNING, ...opts });

describe('header', () => {
  it('shows the date, the greeting by the hour and the offline flag', () => {
    const m = model(onboarded());
    expect(m.todayLabel).toBe('Понеділок, 12 жовтня');
    expect(m.greeting).toBe('Доброго ранку');
    expect(m.offline).toBe(false);
    expect(model(onboarded(), MONDAY, { online: false }).offline).toBe(true);
    expect(OFFLINE_NOTE).toBe('Офлайн · зміни збережено на телефоні');
  });

  it.each([
    [8, 'Доброго ранку'],
    [12, 'Доброго дня'],
    [17, 'Доброго дня'],
    [18, 'Доброго вечора'],
  ])('greets at %i:00 with «%s»', (hour, text) => {
    expect(model(onboarded(), MONDAY, { now: new Date(2026, 9, 12, hour, 0) }).greeting).toBe(text);
  });
});

describe('banner', () => {
  const SETUP = {
    id: 'setup',
    title: 'Почнімо',
    sub: 'Запиши стартову вагу й ціль',
    cta: 'Налаштувати',
    action: { mode: 'setup' },
    dismissible: false,
  };
  const INSTALL = {
    id: 'install',
    title: 'Встанови Легко на iPhone',
    sub: 'Так працюватимуть нагадування',
    cta: 'Як?',
    action: { mode: 'install' },
    dismissible: true,
  };

  it('setup beats the install hint until the first-run setup is done', () => {
    expect(model(emptyData()).banner).toEqual(SETUP);
    expect(model(emptyData(), MONDAY, { showInstallHint: true }).banner).toEqual(SETUP);
  });

  it('keeps the setup sub short enough for the compact 2-line clamp next to «Налаштувати»', () => {
    // ~115px text column at 320, ~185px at 390: the old «… — прогрес рахуватиметься сам» needed a 3rd line and was
    // cut with «…». One short clause, no dash tail.
    const sub = model(emptyData()).banner?.sub ?? '';
    expect(sub).toBe('Запиши стартову вагу й ціль');
    expect(sub.length).toBeLessThanOrEqual(28);
    expect(sub).not.toContain('—');
  });

  it('shows the dismissible install hint once onboarded', () => {
    expect(model(onboarded(), MONDAY, { showInstallHint: true }).banner).toEqual(INSTALL);
  });

  it('reminders never produce a banner (the Monday rows carry them)', () => {
    const m = model(onboarded());
    expect(m.banner).toBeNull();
    expect(m.rows.weight.next.kind).toBe('due');
    expect(m.rows.workout.due).toBe(true);
  });
});

describe('hero', () => {
  it('shows dashes, no badge and the goal before the first weigh-in', () => {
    expect(model(emptyData()).hero).toEqual({
      current: '—',
      badge: null,
      badgeSr: 'Зміна від старту',
      pct: 0,
      progress: '',
      left: '— кг',
      goal: 'Ціль 60,0 кг',
      reached: false,
    });
  });

  it('fills the hero from the weigh-ins', () => {
    expect(model(sample()).hero).toEqual({
      current: '65,4',
      badge: '−3,0 кг',
      badgeSr: 'Втрачено від старту',
      pct: expect.closeTo((3 / 8.4) * 100, 6),
      progress: '36%',
      left: '5,4 кг',
      goal: 'Ціль 60,0 кг',
      reached: false,
    });
  });

  it('shows a gain with a plus and says so to screen readers', () => {
    const data = onboarded({
      weights: [
        { date: '2026-10-05', kg: 60 },
        { date: MONDAY, kg: 61 },
      ],
    });
    expect(model(data).hero).toMatchObject({
      badge: '+1,0 кг',
      badgeSr: 'Набрано від старту',
      left: '1,0 кг',
      pct: 0,
      progress: '0%',
      reached: false,
    });
  });

  it('calls no change a «Зміна від старту»', () => {
    const data = onboarded({
      weights: [
        { date: '2026-10-05', kg: 65 },
        { date: MONDAY, kg: 65.02 },
      ],
    });
    expect(model(data).hero).toMatchObject({ badge: '0,0 кг', badgeSr: 'Зміна від старту' });
  });

  it('is reached at the goal weight, with a full bar', () => {
    const data = onboarded({
      weights: [
        { date: '2026-10-05', kg: 64 },
        { date: MONDAY, kg: 59.5 },
      ],
    });
    expect(model(data).hero).toMatchObject({
      pct: 100,
      progress: '100%',
      left: '0,0 кг',
      badge: '−4,5 кг',
      reached: true,
    });
  });
});

describe('«Їжа» row', () => {
  const food = (entry?: DayEntry, data: AppData = onboarded()) =>
    model({ ...data, days: entry ? { [MONDAY]: entry } : {} }).rows.food;

  it('empty: a dash, the goal and an empty mint meter', () => {
    const row = food();
    expect(row).toMatchObject({ state: 'empty', value: '—', meter: { value: 0, tone: 'acc2' }, sub: null });
    expect(nb(row.goal)).toBe(' / 1 700 ккал');
    expect(nb(row.label)).toBe('Їжа: ще нічого не записано. Ціль 1 700 ккал на день');
    // Zero kcal without food counts as nothing recorded.
    expect(food(day({ kcal: 0 })).state).toBe('empty');
  });

  it.each([
    ['food text', day({ food: 'Вівсянка з бананом, кава' })],
    ['a photo only', day({ photos: ['photo0000000000001'] })],
  ])('recorded (%s, no kcal): «Записано», no goal, no meter', (_, entry) => {
    const row = food(entry);
    expect(row).toEqual({
      state: 'recorded',
      value: 'Записано',
      goal: null,
      meter: null,
      sub: 'Калорії не вказані',
      label: expect.any(String),
    });
    expect(nb(row.label)).toBe('Їжа: записано, калорії не вказані. Ціль 1 700 ккал на день');
  });

  it('whitespace-only food is not «recorded»', () => {
    expect(food(day({ food: '   ' })).state).toBe('empty');
  });

  it('ok: the number against the goal and a mint meter', () => {
    const row = food(day({ food: 'Борщ', kcal: 1650 }));
    expect(row).toMatchObject({ state: 'ok', sub: null, meter: { tone: 'acc2' } });
    expect(row.meter?.value).toBeCloseTo((1650 / 1700) * 100, 6);
    expect(nb(row.value)).toBe('1 650');
    expect(nb(row.goal)).toBe(' / 1 700 ккал');
    expect(nb(row.label)).toBe('Їжа: 1 650 з 1 700 ккал, залишилось 50');
  });

  it('reached: a full mint meter', () => {
    const row = food(day({ kcal: 1700 }));
    expect(row).toMatchObject({ state: 'reached', meter: { value: 100, tone: 'acc2' }, sub: null });
    expect(nb(row.value)).toBe('1 700');
    expect(nb(row.label)).toBe('Їжа: Ціль досягнута: 1 700 ккал');
  });

  it('over: a full lavender meter and the excess first in the name', () => {
    const row = food(day({ food: 'Піца', kcal: 1820 }));
    expect(row).toMatchObject({ state: 'over', meter: { value: 100, tone: 'acc' }, sub: null });
    expect(nb(row.value)).toBe('1 820');
    expect(nb(row.goal)).toBe(' / 1 700 ккал');
    expect(nb(row.label)).toMatch(/^Їжа: Перевищено ціль на 120 ккал/);
  });

  it('uses the daily goal from the settings', () => {
    const data = onboarded();
    const custom = { ...data, settings: { ...data.settings, kcalGoal: 2000 } };
    expect(nb(food(day({ kcal: 1500 }), custom).goal)).toBe(' / 2 000 ккал');
  });
});

describe('«Тренування» row', () => {
  const workout = (entry: DayEntry | undefined, today = MONDAY, data: AppData = onboarded()) =>
    model({ ...data, days: entry ? { [today]: entry } : {} }, today).rows.workout;

  it('planned and not marked: «За планом о 18:00» in lavender, due', () => {
    expect(workout(undefined)).toEqual({
      trained: null,
      sub: 'За планом о 18:00',
      subTone: 'acc',
      due: true,
      label: 'Тренування: за планом о 18:00',
    });
  });

  it('not planned today: «Ще не відмічено», muted', () => {
    expect(workout(day({ food: 'Борщ' }), TUESDAY)).toEqual({
      trained: null,
      sub: 'Ще не відмічено',
      subTone: 'muted',
      due: false,
      label: 'Тренування: ще не відмічено',
    });
  });

  it('is never due before the first-run setup or with the reminder off', () => {
    expect(workout(undefined, MONDAY, emptyData())).toMatchObject({
      sub: 'Ще не відмічено',
      subTone: 'muted',
      due: false,
    });
    const off = onboarded();
    off.settings = {
      ...off.settings,
      rem: { ...off.settings.rem, workout: { on: false, days: [1], time: '18:00' } },
    };
    expect(workout(undefined, MONDAY, off)).toMatchObject({ subTone: 'muted', due: false });
  });

  it('done with types: the types in the default colour', () => {
    expect(workout(day({ trained: true, types: ['Кардіо', 'Прес'] }))).toEqual({
      trained: true,
      sub: 'Кардіо, Прес',
      subTone: undefined,
      due: false,
      label: 'Тренування: Кардіо, Прес',
    });
  });

  it('done without types: nudges to add one', () => {
    expect(workout(day({ trained: true }))).toEqual({
      trained: true,
      sub: 'Було · додай тип',
      subTone: 'acc',
      due: false,
      label: 'Тренування: було · додай тип',
    });
  });

  it('no workout: «Не було» in the default colour', () => {
    expect(workout(day({ trained: false }))).toEqual({
      trained: false,
      sub: 'Не було',
      subTone: undefined,
      due: false,
      label: 'Тренування: не було',
    });
  });
});

describe('«Вага» row', () => {
  const weights = (...items: [string, number][]) => items.map(([date, kg]) => ({ date, kg }));

  it('none yet: «Ще немає зважувань» and the next date', () => {
    expect(model(onboarded(), WEDNESDAY).rows.weight).toEqual({
      sub: 'Ще немає зважувань',
      prefix: null,
      next: { kind: 'date', text: 'Пн, 19 жовтня' },
      label: 'Вага: ще немає зважувань. Наступне: Пн, 19 жовтня · 08:00',
    });
  });

  it('upcoming: the last weigh-in and the next date without the time (the time is in the name)', () => {
    const row = model(sample(), WEDNESDAY).rows.weight;
    expect(row).toEqual({
      sub: '12 жовтня — 65,4 кг',
      prefix: null,
      next: { kind: 'date', text: 'Пн, 19 жовтня' },
      label: 'Вага: останнє зважування 12 жовтня — 65,4 кг. Наступне: Пн, 19 жовтня · 08:00',
    });
    expect(row.next.text).not.toMatch(/\d{2}:\d{2}/);
    expect(row.label).toContain('· 08:00');
  });

  it('«Завтра» for the day before', () => {
    expect(model(sample(), '2026-10-18').rows.weight.next).toEqual({ kind: 'date', text: 'Завтра' });
  });

  it('due: a «Сьогодні» pill and the reminder time in the name', () => {
    const data = onboarded({ weights: weights(['2026-10-05', 67]) });
    expect(model(data).rows.weight).toEqual({
      sub: '5 жовтня — 67,0 кг',
      prefix: null,
      next: { kind: 'due', text: 'Сьогодні' },
      label: 'Вага: зважування сьогодні о 08:00. Останнє зважування 5 жовтня — 67,0 кг',
    });
    expect(model(onboarded()).rows.weight.label).toBe(
      'Вага: зважування сьогодні о 08:00. Ще немає зважувань',
    );
  });

  it('done today: «✓ Сьогодні — 65,4 кг» and next week', () => {
    expect(model(sample()).rows.weight).toEqual({
      sub: 'Сьогодні — 65,4 кг',
      prefix: { text: '✓ ', tone: 'acc2' },
      next: { kind: 'date', text: 'Пн, 19 жовтня' },
      label: 'Вага: сьогодні — 65,4 кг. Наступне: Пн, 19 жовтня · 08:00',
    });
  });

  it('overdue: «Пропущено ·» before the last weigh-in', () => {
    const data = withRem(sample(), { weigh: weekly(2) });
    expect(model(data, WEDNESDAY).rows.weight).toEqual({
      sub: '12 жовтня — 65,4 кг',
      prefix: { text: 'Пропущено · ', tone: 'acc' },
      next: { kind: 'date', text: 'Вт, 20 жовтня' },
      label:
        'Вага: пропущено зважування 13 жовтня. Останнє зважування 12 жовтня — 65,4 кг. Наступне: Вт, 20 жовтня · 08:00',
    });
  });

  it('off: «вимкнено» (never due or overdue)', () => {
    const data = withRem(sample(), { weigh: weekly(2, false) });
    expect(model(data, WEDNESDAY).rows.weight).toEqual({
      sub: '12 жовтня — 65,4 кг',
      prefix: null,
      next: { kind: 'off', text: 'вимкнено' },
      label: 'Вага: останнє зважування 12 жовтня — 65,4 кг. Нагадування вимкнено',
    });
    // Done today with the reminder off: still «✓ Сьогодні», next «вимкнено».
    expect(model(withRem(sample(), { weigh: weekly(1, false) })).rows.weight).toMatchObject({
      prefix: { text: '✓ ', tone: 'acc2' },
      next: { kind: 'off', text: 'вимкнено' },
      label: 'Вага: сьогодні — 65,4 кг. Нагадування вимкнено',
    });
  });

  it('not onboarded: due and overdue show as a plain upcoming date', () => {
    const fresh = emptyData();
    expect(model(fresh).rows.weight).toEqual({
      sub: 'Ще немає зважувань',
      prefix: null,
      next: { kind: 'date', text: 'Сьогодні' },
      label: 'Вага: ще немає зважувань. Наступне: Сьогодні · 08:00',
    });
    const missed = withRem({ ...fresh, weights: weights(['2026-10-12', 65.4]) }, { weigh: weekly(2) });
    expect(model(missed, WEDNESDAY).rows.weight).toMatchObject({
      prefix: null,
      next: { kind: 'date', text: 'Вт, 20 жовтня' },
    });
  });
});

describe('«Заміри» row', () => {
  it('lists the latest value of each set parameter only', () => {
    // Wednesday 7 October: measured on Monday 5th, next on Monday 12th.
    const row = model(sample(), '2026-10-07').rows.measure;
    expect(row).toEqual({
      sub: 'Груди 93 · Талія 73 · Стегна 101',
      prefix: null,
      next: { kind: 'date', text: 'Пн, 12 жовтня' },
      label: 'Заміри: останні заміри — Груди 93 · Талія 73 · Стегна 101. Наступні: Пн, 12 жовтня · 08:30',
    });
    const waistOnly = onboarded({ measures: [measure('2026-10-05', null, 73, null)] });
    expect(model(waistOnly, WEDNESDAY).rows.measure.sub).toBe('Талія 73');
  });

  it('none yet: «Ще немає замірів»', () => {
    expect(model(onboarded(), WEDNESDAY).rows.measure).toMatchObject({
      sub: 'Ще немає замірів',
      label: 'Заміри: ще немає замірів. Наступні: Пн, 19 жовтня · 08:30',
    });
  });

  it('due on Monday with a «Сьогодні» pill', () => {
    expect(model(sample()).rows.measure).toEqual({
      sub: 'Груди 93 · Талія 73 · Стегна 101',
      prefix: null,
      next: { kind: 'due', text: 'Сьогодні' },
      label: 'Заміри: заміри сьогодні о 08:30. Останні заміри — Груди 93 · Талія 73 · Стегна 101',
    });
  });

  it('done today: only what was measured today, with decimals', () => {
    const data = { ...sample(), measures: [...sample().measures, measure(MONDAY, 92.5, 72, null)] };
    expect(model(data).rows.measure).toEqual({
      sub: 'Сьогодні — Груди 92,5 · Талія 72',
      prefix: { text: '✓ ', tone: 'acc2' },
      next: { kind: 'date', text: 'Пн, 19 жовтня' },
      label: 'Заміри: сьогодні — Груди 92,5 · Талія 72. Наступні: Пн, 19 жовтня · 08:30',
    });
  });

  it('overdue: «Пропущено ·» before the values', () => {
    // Last measured on 5 October, so Monday 12th was missed.
    expect(model(sample(), WEDNESDAY).rows.measure).toMatchObject({
      prefix: { text: 'Пропущено · ', tone: 'acc' },
      next: { kind: 'date', text: 'Пн, 19 жовтня' },
    });
    const data = withRem(sample(), { measure: weekly(2, true, '08:30') });
    expect(model(data, WEDNESDAY).rows.measure).toMatchObject({
      sub: 'Груди 93 · Талія 73 · Стегна 101',
      prefix: { text: 'Пропущено · ', tone: 'acc' },
      next: { kind: 'date', text: 'Вт, 20 жовтня' },
      label:
        'Заміри: пропущено заміри 13 жовтня. Останні заміри — Груди 93 · Талія 73 · Стегна 101. Наступні: Вт, 20 жовтня · 08:30',
    });
  });

  it('off: «вимкнено»', () => {
    const data = withRem(sample(), { measure: weekly(1, false, '08:30') });
    expect(model(data, WEDNESDAY).rows.measure.next).toEqual({ kind: 'off', text: 'вимкнено' });
  });
});

describe('week row', () => {
  it('trainings of planned and the average kcal since Monday', () => {
    const week = model(sample()).week;
    expect(nb(week.text)).toBe('1 з 3 трен. · сер. 1 650 ккал');
    expect(nb(week.label)).toBe(
      'Тиждень: 1 з 3 тренувань, середня калорійність 1 650 ккал. Відкрити прогрес',
    );
    expect(week.href).toBe('/progress?period=week');
  });

  it('glues each half with no-break spaces, so it can only wrap after « · »', () => {
    const week = model(sample()).week;
    // Only the two spaces around «·» are ordinary; everything else (incl. the «1 650» group separator) is NBSP-like.
    expect(week.text.split(' ')).toEqual([`1${NB}з${NB}3${NB}трен.`, '·', `сер.${NB}${f0(1650)}${NB}ккал`]);
    expect(week.text).toBe(`1${NB}з${NB}3${NB}трен. · сер.${NB}${f0(1650)}${NB}ккал`);
    // The accessible name keeps ordinary spaces.
    expect(week.label).toBe(
      `Тиждень: 1 з 3 тренувань, середня калорійність ${f0(1650)} ккал. Відкрити прогрес`,
    );
  });

  it('drops the kcal part without calories', () => {
    const week = model(onboarded()).week;
    expect(week.text).toBe(`0${NB}з${NB}3${NB}трен.`);
    expect(nb(week.text)).toBe('0 з 3 трен.');
    expect(week.text).not.toContain(' ');
    expect(week.label).toBe('Тиждень: 0 з 3 тренувань. Відкрити прогрес');
  });

  it('has no «з N» without planned workout days', () => {
    const noPlan = (days: Record<string, DayEntry>) => {
      const data = onboarded({ days });
      data.settings = {
        ...data.settings,
        rem: { ...data.settings.rem, workout: { on: false, days: [], time: '18:00' } },
      };
      return model(data, '2026-10-18').week;
    };
    const trained = (dates: string[]) => Object.fromEntries(dates.map((d) => [d, day({ trained: true })]));
    expect(noPlan(trained(['2026-10-12', '2026-10-13']))).toMatchObject({
      text: `2${NB}трен.`,
      label: 'Тиждень: 2 тренування. Відкрити прогрес',
    });
    // No plan, with calories: «2 трен. · сер. 1 500 ккал», still breaking only after « · ».
    const withKcal = noPlan({
      '2026-10-12': day({ trained: true, kcal: 1400 }),
      '2026-10-13': day({ trained: true, kcal: 1600 }),
    });
    expect(withKcal.text).toBe(`2${NB}трен. · сер.${NB}${f0(1500)}${NB}ккал`);
    expect(withKcal.text.split(' ')).toHaveLength(3);
    expect(noPlan(trained(['2026-10-12'])).label).toBe('Тиждень: 1 тренування. Відкрити прогрес');
    expect(
      noPlan(trained(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])).label,
    ).toBe('Тиждень: 5 тренувань. Відкрити прогрес');
    expect(noPlan({}).label).toBe('Тиждень: 0 тренувань. Відкрити прогрес');
  });

  it('says «з 1 тренування» for a single planned day', () => {
    const data = onboarded();
    data.settings = {
      ...data.settings,
      rem: { ...data.settings.rem, workout: { on: true, days: [1], time: '18:00' } },
    };
    expect(model(data).week).toMatchObject({
      text: `0${NB}з${NB}1${NB}трен.`,
      label: 'Тиждень: 0 з 1 тренування. Відкрити прогрес',
    });
  });
});

describe('HOME_ROW_ACTIONS', () => {
  it('opens each row’s short sheet without a patch', () => {
    expect(HOME_ROW_ACTIONS).toEqual({
      food: { mode: 'food' },
      workout: { mode: 'workout' },
      weight: { mode: 'weight' },
      measure: { mode: 'measure' },
    });
  });
});

describe('never shows NaN, undefined, null or Infinity', () => {
  const cases: [string, AppData, string][] = [
    ['a brand-new user', emptyData(), MONDAY],
    ['onboarded, nothing recorded', onboarded(), WEDNESDAY],
    ['sample data on Monday', sample(), MONDAY],
    ['sample data on Wednesday', sample(), WEDNESDAY],
    ['a missed weigh-in', withRem(sample(), { weigh: weekly(2), measure: weekly(2) }), WEDNESDAY],
    ['reminders off', withRem(sample(), { weigh: weekly(1, false), measure: weekly(1, false) }), WEDNESDAY],
    ['over the kcal goal', onboarded({ days: { [MONDAY]: day({ kcal: 1820, trained: false }) } }), MONDAY],
  ];

  it.each(cases)('%s', (_, data, today) => {
    const m = model(data, today, { showInstallHint: true, online: false });
    const texts = stringsOf(m);
    expect(texts.length).toBeGreaterThan(15);
    for (const text of texts) expect(text).not.toMatch(/NaN|undefined|null|Infinity/);
    expect(Number.isFinite(m.hero.pct)).toBe(true);
    for (const row of [m.rows.food.meter]) if (row) expect(Number.isFinite(row.value)).toBe(true);
  });
});
