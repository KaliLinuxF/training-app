import { f0, type AppData, type Meal } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { NBSP } from '@/lib/nutrition';
import type { Period } from '@/lib/stats';
import type { StatItem } from '@/ui';
import {
  buildProgressModel,
  HISTORY_FIRST,
  HISTORY_PAGE,
  MACROS_LABEL,
  NO_MACROS_IN_PERIOD,
  TYPES_SHOWN,
  type ProgressOptions,
  type SummaryItem,
} from './model';
import {
  freshData,
  meal,
  mealDay,
  MEALS_THU,
  MEALS_TUE,
  MEALS_WED,
  progressData,
  TODAY,
} from './progress.fixtures';

const opts = (patch: Partial<ProgressOptions> = {}): ProgressOptions => ({
  period: 'week',
  measure: 'waist',
  historyLimit: HISTORY_FIRST,
  ...patch,
});

const build = (data: AppData, patch: Partial<ProgressOptions> = {}) =>
  buildProgressModel(data, TODAY, opts(patch));

/** `[label, value, unit, tone]` — compact to compare. */
const items = (list: readonly SummaryItem[]) => list.map((c) => [c.label, c.value, c.unit, c.tone]);
/** `[label, value, unit, tone]` of a StatStrip. */
const stats = (list: readonly StatItem[]) => list.map((c) => [c.label, c.value, c.unit, c.tone]);

describe('buildProgressModel — summary sentence', () => {
  it('summarises the current week in SPEC §1.1 #7 order and wording', () => {
    const { summary } = build(progressData());
    expect(summary.title).toBe('Цього тижня');
    expect(summary.items.map((i) => i.key)).toEqual(['workouts', 'kcal', 'weight', 'waist', 'hips', 'chest']);
    expect(items(summary.items)).toEqual([
      ['Тренувань', '2', '', 'ink'],
      ['сер. калорійність', f0(1650), 'ккал', 'ink'],
      ['вага', '−0,4', 'кг', 'acc2'],
      ['талія', '−2', 'см', 'acc2'],
      ['стегна', '−0,5', 'см', 'acc2'],
      ['груди', '−0,5', 'см', 'acc2'],
    ]);
  });

  it('follows the selected period', () => {
    const { summary } = build(progressData(), { period: 'month' });
    expect(summary.title).toBe('За останні 30 днів');
    // 10 Sep … 9 Oct: 7 cardio + 2 this week; 25 × 1600 + 6600 over 29 days.
    // Baselines = the last readings before the period (7 Sep: 67,0 kg; waist 72, hips 100, chest 92).
    expect(items(summary.items)).toEqual([
      ['Тренувань', '9', '', 'ink'],
      ['сер. калорійність', f0(46600 / 29), 'ккал', 'ink'],
      ['вага', '−1,6', 'кг', 'acc2'],
      ['талія', '−2', 'см', 'acc2'],
      ['стегна', '−0,5', 'см', 'acc2'],
      ['груди', '−0,5', 'см', 'acc2'],
    ]);
    // 3 months from 12 July: no reading before, so first → last of the period.
    const q = build(progressData(), { period: 'q' }).summary;
    expect(q.title).toBe('За 3 місяці');
    expect(items(q.items).slice(2)).toEqual([
      ['вага', '−3,0', 'кг', 'acc2'],
      ['талія', '−4', 'см', 'acc2'],
      ['стегна', '−1,5', 'см', 'acc2'],
      ['груди', '−1,5', 'см', 'acc2'],
    ]);
  });

  it('tones gains lavender and no change ink, with signs', () => {
    const data = progressData();
    data.weights.push({ date: '2026-10-08', kg: 65.9 });
    data.measures.push({ date: '2026-10-08', chest: 92, waist: 72, hips: 99.5 });
    expect(items(build(data).summary.items).slice(2)).toEqual([
      ['вага', '+0,1', 'кг', 'acc'],
      ['талія', '0', 'см', 'ink'],
      ['стегна', '−0,5', 'см', 'acc2'],
      ['груди', '0', 'см', 'ink'],
    ]);
  });

  it('shows a faint «—» without a unit for everything a fresh account lacks', () => {
    const { summary } = build(freshData());
    expect(items(summary.items)).toEqual([
      ['Тренувань', '—', '', 'faint'],
      ['сер. калорійність', '—', '', 'faint'],
      ['вага', '—', '', 'faint'],
      ['талія', '—', '', 'faint'],
      ['стегна', '—', '', 'faint'],
      ['груди', '—', '', 'faint'],
    ]);
  });

  it('counts «0» workouts once the period has a day record, and leaves kcal out when none has kcal', () => {
    const data = freshData();
    data.days[TODAY] = { food: 'Суп', kcal: null, trained: false, types: [], notes: '' };
    const [workouts, kcal] = build(data).summary.items;
    expect(workouts).toEqual({ key: 'workouts', label: 'Тренувань', value: '0', unit: '', tone: 'ink' });
    expect(kcal).toEqual({ key: 'kcal', label: 'сер. калорійність', value: '—', unit: '', tone: 'faint' });
  });
});

describe('buildProgressModel — weight', () => {
  it('shows current, the all-time change «від старту», start, left, goal and the way', () => {
    const w = build(progressData()).weight;
    expect(w.current).toBe('65,4');
    expect(w.change).toEqual({ text: '−3,0 кг від старту', tone: 'acc2' });
    expect(w.start).toBe('68,4');
    expect(w.goal).toBe('60,0');
    expect(w.left).toBe('ще 5,4 кг');
    // 3,0 of 8,4 kg.
    expect(w.pct).toBeCloseTo((3 / 8.4) * 100);
    expect(w.pctLabel).toBe('36% шляху');
  });

  it('shows a gain with a plus in lavender', () => {
    const data = progressData();
    data.weights.push({ date: '2026-10-08', kg: 69 });
    const w = build(data).weight;
    expect(w.current).toBe('69,0');
    expect(w.change).toEqual({ text: '+0,6 кг від старту', tone: 'acc' });
    expect(w.left).toBe('ще 9,0 кг');
    expect(w.pct).toBe(0);
    expect(w.pctLabel).toBe('0% шляху');
  });

  it('shows no change in the neutral tone', () => {
    const data = freshData();
    data.weights = [
      { date: '2026-10-01', kg: 70 },
      { date: TODAY, kg: 70 },
    ];
    expect(build(data).weight.change).toEqual({ text: '0,0 кг від старту', tone: 'neutral' });
  });

  it('is empty before the first weigh-in', () => {
    const w = build(freshData()).weight;
    expect(w).toMatchObject({
      current: '—',
      change: null,
      start: '—',
      goal: '60,0',
      left: '',
      pct: 0,
      pctLabel: '',
    });
    expect(w.chart.enough).toBe(false);
    expect(w.chart.emptyHint).toBe('Запиши перше зважування, щоб бачити динаміку');
    expect(w.chart.ariaLabel).toBe('');
  });

  it('has no «від старту» change with a single weigh-in (it is the start)', () => {
    const data = freshData();
    data.weights = [{ date: TODAY, kg: 70 }];
    const w = build(data).weight;
    expect(w).toMatchObject({
      current: '70,0',
      change: null,
      start: '70,0',
      left: 'ще 10,0 кг',
      pctLabel: '0% шляху',
    });
    expect(w.chart.enough).toBe(false);
    expect(w.chart.emptyHint).toBe('Потрібно щонайменше два зважування');
  });

  it('charts the last 4 weigh-ins when the period has fewer', () => {
    const { chart } = build(progressData()).weight;
    expect(chart.enough).toBe(true);
    expect(chart.geometry.dots).toHaveLength(4);
    expect(chart.geometry.from).toBe('14.09');
    expect(chart.geometry.to).toBe('05.10');
    expect(chart.geometry.tag?.text).toBe('65,4');
    expect(chart.ariaLabel).toBe('Вага: з 14 вересня по 5 жовтня, від 66,6 до 65,4 кг');
  });

  it('charts every weigh-in of a long period', () => {
    expect(build(progressData(), { period: 'all' }).weight.chart.geometry.dots).toHaveLength(9);
  });
});

describe('buildProgressModel — measurements', () => {
  it('lists first → latest per parameter with the change', () => {
    const { rows, chartLabel, chart } = build(progressData()).measures;
    expect(rows.map((r) => [r.label, r.range, r.delta, r.deltaTone, r.selected])).toEqual([
      ['Груди', '93 → 91,5 см', '−1,5 см', 'acc2', false],
      ['Талія', '74 → 70 см', '−4 см', 'acc2', true],
      ['Стегна', '101 → 99,5 см', '−1,5 см', 'acc2', false],
    ]);
    expect(rows[1]?.ariaLabel).toBe('Талія: 74 → 70 см, зміна −4 см');
    expect(chartLabel).toBe('Талія, см');
    expect(chart.enough).toBe(true);
    expect(chart.geometry.dots).toHaveLength(3);
    expect(chart.geometry.tag?.text).toBe('70');
  });

  it('charts the selected parameter', () => {
    const { rows, chartLabel, chart } = build(progressData(), { measure: 'hips' }).measures;
    expect(rows.find((r) => r.selected)?.key).toBe('hips');
    expect(chartLabel).toBe('Стегна, см');
    expect(chart.ariaLabel).toBe('Стегна: з 10 серпня по 5 жовтня, від 101 до 99,5 см');
  });

  it('handles parameters that were never measured', () => {
    const data = freshData();
    data.measures = [{ date: TODAY, chest: null, waist: 71, hips: null }];
    const { rows, chart } = build(data).measures;
    expect(rows.map((r) => [r.range, r.delta, r.deltaTone])).toEqual([
      ['ще немає', '—', 'faint'],
      ['71 → 71 см', '0 см', 'ink'],
      ['ще немає', '—', 'faint'],
    ]);
    expect(rows[0]?.ariaLabel).toBe('Груди: замірів ще немає');
    expect(chart.enough).toBe(false);
    expect(chart.emptyHint).toBe('Потрібно щонайменше два заміри');
    expect(build(freshData()).measures.chart.emptyHint).toBe('Запиши заміри, щоб бачити динаміку');
  });
});

describe('buildProgressModel — workouts', () => {
  it('counts workouts in a 4-cell strip and ranks the types of the period', () => {
    const { stats: cells, typesHeading, types } = build(progressData()).workouts;
    expect(stats(cells)).toEqual([
      ['Всього', '10', undefined, undefined],
      ['Цього тижня', '2', undefined, undefined],
      ['Цього місяця', '3', undefined, undefined],
      // 10 workouts over 60 days since 10 Aug.
      ['В сер. / тиж.', '1,2', undefined, undefined],
    ]);
    expect(typesHeading).toBe('Найчастіше · цього тижня');
    expect(types.map((t) => [t.label, t.value, t.pct])).toEqual([
      ['Верх тіла', '1', 100],
      ['Низ тіла', '1', 100],
      ['Прес', '1', 100],
    ]);
  });

  it('ranks by frequency for longer periods', () => {
    const { typesHeading, types } = build(progressData(), { period: 'month' }).workouts;
    expect(typesHeading).toBe('Найчастіше · за останні 30 днів');
    expect(types[0]).toEqual({ label: 'Кардіо', value: '7', pct: 100 });
    expect(types).toHaveLength(4);
    expect(types[1]?.pct).toBeCloseTo(100 / 7);
  });

  it(`lists only the ${TYPES_SHOWN} most frequent types`, () => {
    const data = progressData();
    // Seven more types this week, «Йога» twice: it ranks first, the long tail is cut off.
    const extra = ['Йога', 'Біг', 'Плавання', 'Стретчинг', 'Велосипед', 'Танці', 'Бокс'];
    data.days['2026-10-06'] = { ...data.days['2026-10-06']!, trained: true, types: extra };
    data.days['2026-10-08'] = { ...data.days['2026-10-08']!, trained: true, types: ['Йога'] };
    const { types } = build(data).workouts;
    expect(types).toHaveLength(TYPES_SHOWN);
    expect(types.map((t) => t.label)).toEqual(['Йога', 'Верх тіла', 'Біг', 'Плавання', 'Стретчинг']);
    expect(types[0]).toEqual({ label: 'Йога', value: '2', pct: 100 });
  });

  it('is empty for a period without workouts', () => {
    const { stats: cells, types } = build(freshData()).workouts;
    expect(types).toEqual([]);
    expect(cells.map((t) => t.value)).toEqual(['0', '0', '0', '0']);
  });
});

describe('buildProgressModel — nutrition', () => {
  it('shows the two averages, the goal and 7 labelled bars for the week', () => {
    const n = build(progressData()).nutrition;
    expect(n.goal).toBe(`ціль ${f0(1700)} ккал`);
    // Week: (1600 + 1800 + 1500 + 1700) / 4; month from 1 Oct: (4 × 1600 + 6600) / 8. Both within 1 700.
    expect(stats(n.stats)).toEqual([
      ['Сер. цього тижня', f0(1650), 'ккал', 'acc2'],
      ['Сер. цього місяця', f0(1625), 'ккал', 'acc2'],
    ]);
    expect(n.labeled).toBe(true);
    expect(n.gap).toBe('8px');
    expect(n.note).toBe('');
    expect(n.hasBarData).toBe(true);
    expect(n.bars.map((b) => [b.label, b.tone])).toEqual([
      ['Пн', 'ok'],
      ['Вт', 'over'],
      ['Ср', 'ok'],
      ['Чт', 'ok'],
      ['Пт', 'empty'],
      ['Сб', 'empty'],
      ['Нд', 'empty'],
    ]);
    expect(n.chartLabel).toBe(`Калорії цього тижня, ціль ${f0(1700)} ккал`);
  });

  it('has no «Період» cell (the summary sentence has the period average)', () => {
    for (const period of ['week', 'month', 'q', 'all'] as const) {
      expect(build(progressData(), { period }).nutrition.stats.map((c) => c.label)).toEqual([
        'Сер. цього тижня',
        'Сер. цього місяця',
      ]);
    }
  });

  it('tones an average above the goal lavender', () => {
    const data = progressData();
    data.settings.kcalGoal = 1640;
    expect(stats(build(data).nutrition.stats)).toEqual([
      ['Сер. цього тижня', f0(1650), 'ккал', 'acc'],
      ['Сер. цього місяця', f0(1625), 'ккал', 'acc2'],
    ]);
  });

  it.each<[Period, number, string]>([
    ['month', 30, ''],
    // Weeks from Monday 6 July (the week of today − 89) to Monday 5 October.
    ['q', 14, '· середнє за тиждень'],
    // Weeks from Monday 10 August (first weigh-in).
    ['all', 9, '· середнє за тиждень'],
  ])('uses %s bars: %i, note «%s»', (period, count, note) => {
    const n = build(progressData(), { period }).nutrition;
    expect(n.bars).toHaveLength(count);
    expect(n.note).toBe(note);
    expect(n.labeled).toBe(false);
    expect(n.gap).toBe('3px');
  });

  it('lists the kcal history newest first with the weekday, 3 rows at first', () => {
    const data = progressData();
    data.days[TODAY] = { ...data.days[TODAY]!, kcal: 1750 };
    const n = build(data).nutrition;
    expect(HISTORY_FIRST).toBe(3);
    expect(n.history.map((r) => [r.label, r.value, r.tone, r.href])).toEqual([
      ['Пт, 9 жовтня', `${f0(1750)} ккал`, 'over', '/calendar?date=2026-10-09'],
      ['Чт, 8 жовтня', `${f0(1700)} ккал`, 'ok', '/calendar?date=2026-10-08'],
      ['Ср, 7 жовтня', `${f0(1500)} ккал`, 'ok', '/calendar?date=2026-10-07'],
    ]);
    expect(n.history[0]?.ariaLabel).toBe(`9 жовтня: ${f0(1750)} ккал. Відкрити в календарі`);
    expect(n.hasMore).toBe(true);

    const more = build(data, { historyLimit: HISTORY_FIRST + HISTORY_PAGE }).nutrition;
    expect(more.history).toHaveLength(10);
    expect(more.history.at(-1)?.label).toBe('Ср, 30 вересня');
    expect(more.hasMore).toBe(true);

    const all = build(data, { historyLimit: 100 }).nutrition;
    expect(all.history).toHaveLength(33);
    expect(all.hasMore).toBe(false);
  });

  it('labels each weekday of a week correctly', () => {
    const n = build(progressData(), { historyLimit: 7 }).nutrition;
    expect(n.history.map((r) => r.label)).toEqual([
      'Чт, 8 жовтня',
      'Ср, 7 жовтня',
      'Вт, 6 жовтня',
      'Пн, 5 жовтня',
      'Нд, 4 жовтня',
      'Сб, 3 жовтня',
      'Пт, 2 жовтня',
    ]);
  });

  it('has an intentional empty state', () => {
    const n = build(freshData()).nutrition;
    expect(stats(n.stats)).toEqual([
      ['Сер. цього тижня', '—', undefined, 'faint'],
      ['Сер. цього місяця', '—', undefined, 'faint'],
    ]);
    expect(n.macros.items).toBeNull();
    expect(n.macros.empty).toBe(NO_MACROS_IN_PERIOD);
    expect(n.hasBarData).toBe(false);
    expect(n.history).toEqual([]);
    expect(n.hasMore).toBe(false);
  });
});

/** Whitespace (incl. NBSP) as plain spaces, to compare copy. */
const plain = (s: string) => s.replace(/\s+/g, ' ');
/** `[label, value, unit, tone]` of the «Б · Ж · В» strip, labels as plain text. */
const macroCells = (data: AppData, patch: Partial<ProgressOptions> = {}) =>
  (build(data, patch).nutrition.macros.items ?? []).map((c) => [plain(c.label), c.value, c.unit, c.tone]);

/** progressData with one day replaced by `meals` (kcal of the day = their sum). */
function withDay(date: string, meals: Meal[], data: AppData = progressData()): AppData {
  data.days[date] = mealDay(meals, { trained: data.days[date]?.trained ?? null });
  return data;
}

describe('buildProgressModel — Б · Ж · В', () => {
  it('the fixture keeps every day kcal: meal days sum to the same numbers', () => {
    const { days } = progressData();
    expect([days['2026-10-06']?.kcal, days['2026-10-07']?.kcal, days['2026-10-08']?.kcal]).toEqual([
      1800, 1500, 1700,
    ]);
    expect(days['2026-10-07']?.meals?.map((m) => m.id)).toEqual(['wedDinner', 'legacy']);
  });

  it('averages each macronutrient per day over the complete days of the week, in whole grams', () => {
    const { macros } = build(progressData()).nutrition;
    expect(plain(macros.caption)).toBe('Б · Ж · В — середнє за день · цього тижня');
    expect(macros.label).toBe(MACROS_LABEL);
    expect(macros.empty).toBeNull();
    // Tue 100 / 60 / 200 and Thu 97 / 58 / 188 (the energy-free tea on Tue is ignored); Wed is partial, Mon and today
    // are legacy days: left out. Protein 98,5 shows as 99.
    expect(macroCells(progressData())).toEqual([
      ['Білки', '99', 'г', 'ink'],
      ['Жири', '59', 'г', 'ink'],
      ['Вуглеводи', '194', 'г', 'ink'],
    ]);
  });

  it('leaves out a day with a legacy block next to an AI meal, and legacy days with kcal', () => {
    // Only Wednesday (legacy block 600 kcal + AI meal with positions) and the legacy days: nothing counts.
    const data = progressData();
    delete data.days['2026-10-06'];
    delete data.days['2026-10-08'];
    const { macros } = build(data).nutrition;
    expect(macros.items).toBeNull();
    expect(macros.empty).toBe(NO_MACROS_IN_PERIOD);
    expect(plain(macros.caption)).toBe('Б · Ж · В — середнє за день · цього тижня');
    // Once the legacy block is gone, the AI meal alone is a complete day.
    const complete = withDay(
      '2026-10-07',
      MEALS_WED.filter((m) => m.id !== 'legacy'),
      data,
    );
    expect(macroCells(complete)).toEqual([
      ['Білки', '48', 'г', 'ink'],
      ['Жири', '44', 'г', 'ink'],
      ['Вуглеводи', '80', 'г', 'ink'],
    ]);
  });

  it('decides per macronutrient: a day missing one of them still counts for the others', () => {
    // Thursday's dinner without fat: Thursday counts for protein and carbs, not for fat.
    const thu = MEALS_THU.map((m) => (m.id === 'thuDinner' ? { ...m, fat: null } : m));
    expect(macroCells(withDay('2026-10-08', thu))).toEqual([
      ['Білки', '99', 'г', 'ink'],
      ['Жири', '60', 'г', 'ink'],
      ['Вуглеводи', '194', 'г', 'ink'],
    ]);
    // A position with energy but without carbs makes Tuesday partial for carbs only.
    const tue = MEALS_TUE.map((m) =>
      m.id === 'tueLunch' && m.items
        ? { ...m, items: m.items.map((i, n) => (n === 0 ? { ...i, carbs: null } : i)) }
        : m,
    );
    expect(macroCells(withDay('2026-10-06', tue))).toEqual([
      ['Білки', '99', 'г', 'ink'],
      ['Жири', '59', 'г', 'ink'],
      ['Вуглеводи', '188', 'г', 'ink'],
    ]);
  });

  it('shows a faint «—» without a unit for a macronutrient no complete day has', () => {
    const data = freshData();
    data.days[TODAY] = mealDay([
      meal({
        id: 'm1',
        type: 'Обід',
        time: '13:00',
        text: 'Суп',
        kcal: 300,
        protein: 12,
        fat: null,
        carbs: 30,
      }),
    ]);
    expect(macroCells(data)).toEqual([
      ['Білки', '12', 'г', 'ink'],
      ['Жири', '—', undefined, 'faint'],
      ['Вуглеводи', '30', 'г', 'ink'],
    ]);
  });

  it('puts a goal into the label, keeps the unit «г» and tones a rounded average above it lavender', () => {
    const data = progressData();
    data.settings.macroGoals = { protein: 98, fat: 59, carbs: null };
    // 98,5 rounds to 99 > 98: over. 59 = 59: not over.
    expect(macroCells(data)).toEqual([
      ['Білки · ціль 98 г', '99', 'г', 'acc'],
      ['Жири · ціль 59 г', '59', 'г', 'ink'],
      ['Вуглеводи', '194', 'г', 'ink'],
    ]);
    data.settings.macroGoals = { protein: 99, fat: null, carbs: 1000 };
    expect(macroCells(data)).toEqual([
      ['Білки · ціль 99 г', '99', 'г', 'ink'],
      ['Жири', '59', 'г', 'ink'],
      ['Вуглеводи · ціль 1 000 г', '194', 'г', 'ink'],
    ]);
    // The label may wrap only after the dot: «Білки ·» / «ціль 99 г».
    expect(build(data).nutrition.macros.items?.[0]?.label).toBe(`Білки${NBSP}· ціль${NBSP}99${NBSP}г`);
  });

  it('follows the selected period, with its own short phrase in the caption', () => {
    const data = progressData();
    // 10 September is inside the 30 days, not inside the week.
    data.days['2026-09-10'] = mealDay(
      [meal({ id: 'sep', type: 'Обід', text: 'Паста', kcal: 1600, protein: 80, fat: 50, carbs: 190 })],
      { trained: true, types: ['Кардіо'] },
    );
    const caption = (period: Period) => plain(build(data, { period }).nutrition.macros.caption);
    expect(caption('week')).toBe('Б · Ж · В — середнє за день · цього тижня');
    expect(caption('month')).toBe('Б · Ж · В — середнє за день · за 30 днів');
    expect(caption('q')).toBe('Б · Ж · В — середнє за день · за 3 місяці');
    expect(caption('all')).toBe('Б · Ж · В — середнє за день · за весь час');
    expect(macroCells(data)).toEqual([
      ['Білки', '99', 'г', 'ink'],
      ['Жири', '59', 'г', 'ink'],
      ['Вуглеводи', '194', 'г', 'ink'],
    ]);
    // (100 + 97 + 80) / 3 = 92,3 · (60 + 58 + 50) / 3 = 56 · (200 + 188 + 190) / 3 = 192,7.
    for (const period of ['month', 'q', 'all'] as const) {
      expect(macroCells(data, { period })).toEqual([
        ['Білки', '92', 'г', 'ink'],
        ['Жири', '56', 'г', 'ink'],
        ['Вуглеводи', '193', 'г', 'ink'],
      ]);
    }
  });

  it('keeps «Б · Ж · В —» on one line and the dot before the period', () => {
    const { caption } = build(progressData()).nutrition.macros;
    expect(caption.startsWith(`Б${NBSP}·${NBSP}Ж${NBSP}·${NBSP}В${NBSP}—`)).toBe(true);
    expect(caption.endsWith(`${NBSP}·${' '}цього${NBSP}тижня`)).toBe(true);
  });

  it('wraps the caption only inside «середнє за день» or after its « ·», never inside the period phrase', () => {
    const head = `Б${NBSP}·${NBSP}Ж${NBSP}·${NBSP}В${NBSP}— середнє за день${NBSP}·${' '}`;
    const caption = (period: Period) => build(progressData(), { period }).nutrition.macros.caption;
    expect(caption('week')).toBe(`${head}цього${NBSP}тижня`);
    expect(caption('month')).toBe(`${head}за${NBSP}30${NBSP}днів`);
    expect(caption('q')).toBe(`${head}за${NBSP}3${NBSP}місяці`);
    expect(caption('all')).toBe(`${head}за${NBSP}весь${NBSP}час`);
    for (const period of ['week', 'month', 'q', 'all'] as const) {
      const phrase = caption(period).slice(head.length);
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toMatch(/ /);
      // The only ordinary spaces: «— середнє за день» (three) and the one after « ·».
      expect(caption(period).split(' ')).toHaveLength(5);
    }
  });

  it('leaves the kcal strip, the summary sentence and the chart as they were', () => {
    const data = progressData();
    data.settings.macroGoals = { protein: 90, fat: 60, carbs: 150 };
    const m = build(data);
    expect(m.nutrition.stats.map((c) => c.label)).toEqual(['Сер. цього тижня', 'Сер. цього місяця']);
    expect(m.summary.items.map((i) => i.key)).toEqual([
      'workouts',
      'kcal',
      'weight',
      'waist',
      'hips',
      'chest',
    ]);
    expect(m.nutrition.chartLabel).toBe(`Калорії цього тижня, ціль ${f0(1700)} ккал`);
  });
});

describe('buildProgressModel — robustness', () => {
  it.each<Period>(['week', 'month', 'q', 'all'])('never produces NaN or undefined text (%s)', (period) => {
    for (const data of [freshData(), progressData()]) {
      const json = JSON.stringify(build(data, { period }));
      expect(json).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
