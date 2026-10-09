import { f0, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { Period } from '@/lib/stats';
import type { StatItem } from '@/ui';
import {
  buildProgressModel,
  HISTORY_FIRST,
  HISTORY_PAGE,
  TYPES_SHOWN,
  type ProgressOptions,
  type SummaryItem,
} from './model';
import { freshData, progressData, TODAY } from './progress.fixtures';

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
    expect(n.hasBarData).toBe(false);
    expect(n.history).toEqual([]);
    expect(n.hasMore).toBe(false);
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
