import { f0, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { Period } from '@/lib/stats';
import { buildProgressModel, HISTORY_PAGE, type ProgressOptions, type ValueCell } from './model';
import { freshData, progressData, TODAY } from './progress.fixtures';

const opts = (patch: Partial<ProgressOptions> = {}): ProgressOptions => ({
  period: 'week',
  measure: 'waist',
  historyLimit: HISTORY_PAGE,
  ...patch,
});

const build = (data: AppData, patch: Partial<ProgressOptions> = {}) => buildProgressModel(data, TODAY, opts(patch));

/** `[label, value, tone]` triples — compact to compare. */
const cells = (list: readonly ValueCell[]) => list.map((c) => [c.label, c.value, c.tone]);

describe('buildProgressModel — summary', () => {
  it('summarises the current week like the prototype', () => {
    const m = build(progressData());
    expect(m.period.title).toBe('Цього тижня');
    expect(cells(m.summary)).toEqual([
      ['Тренувань', '2', 'ink'],
      ['Середня калорійність', `${f0(1650)} ккал`, 'ink'],
      ['Зміна ваги', '−0,4 кг', 'acc2'],
      ['Талія', '−2 см', 'acc2'],
      ['Стегна', '−0,5 см', 'acc2'],
      ['Груди', '−0,5 см', 'acc2'],
    ]);
  });

  it('follows the selected period', () => {
    const m = build(progressData(), { period: 'month' });
    expect(m.period.title).toBe('За останні 30 днів');
    // 10 Sep … 9 Oct: 7 cardio + 2 this week; 25 × 1600 + 6600 over 29 days.
    expect(m.summary[0]?.value).toBe('9');
    expect(m.summary[1]?.value).toBe(`${f0(46600 / 29)} ккал`);
    // Baseline = last weigh-in before the period (7 Sep, 67,0).
    expect(m.summary[2]?.value).toBe('−1,6 кг');
  });

  it('tones gains lavender and missing changes ink', () => {
    const data = progressData();
    data.weights.push({ date: '2026-10-08', kg: 65.9 });
    const m = build(data);
    expect(m.summary[2]).toEqual({ label: 'Зміна ваги', value: '+0,1 кг', tone: 'acc' });

    const fresh = build(freshData());
    expect(cells(fresh.summary)).toEqual([
      ['Тренувань', '0', 'ink'],
      ['Середня калорійність', '—', 'ink'],
      ['Зміна ваги', '—', 'ink'],
      ['Талія', '—', 'ink'],
      ['Стегна', '—', 'ink'],
      ['Груди', '—', 'ink'],
    ]);
  });
});

describe('buildProgressModel — weight', () => {
  it('shows start / current / goal / lost / left / way', () => {
    const m = build(progressData());
    expect(cells(m.weight.tiles)).toEqual([
      ['Початкова', '68,4', undefined],
      ['Поточна', '65,4', undefined],
      ['Цільова', '60,0', undefined],
      ['Втрачено', '3,0 кг', 'acc2'],
      ['Залишилось', '5,4 кг', undefined],
      ['Шлях', '36%', 'acc'],
    ]);
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

  it('shows a gain with a typographic minus', () => {
    const data = progressData();
    data.weights.push({ date: '2026-10-08', kg: 69 });
    expect(build(data).weight.tiles[3]).toEqual({ label: 'Втрачено', value: '−0,6 кг', tone: 'acc' });
  });

  it('asks for more weigh-ins instead of drawing a chart from one point', () => {
    const none = build(freshData()).weight;
    expect(none.chart.enough).toBe(false);
    expect(none.chart.emptyHint).toBe('Запиши перше зважування, щоб бачити динаміку');
    expect(none.chart.ariaLabel).toBe('');
    expect(cells(none.tiles).map((c) => c[1])).toEqual(['—', '—', '60,0', '—', '—', '—']);

    const data = freshData();
    data.weights = [{ date: TODAY, kg: 70 }];
    const one = build(data).weight;
    expect(one.chart.enough).toBe(false);
    expect(one.chart.emptyHint).toBe('Потрібно щонайменше два зважування');
    expect(one.tiles[3]).toEqual({ label: 'Втрачено', value: '0,0 кг', tone: 'acc2' });
    expect(one.tiles[5]).toEqual({ label: 'Шлях', value: '0%', tone: 'acc' });
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
  it('counts workouts and ranks the types of the period', () => {
    const { tiles, typesHeading, types } = build(progressData()).workouts;
    expect(cells(tiles).map((c) => [c[0], c[1]])).toEqual([
      ['Всього', '10'],
      ['Цього тижня', '2'],
      ['Цього місяця', '3'],
      // 10 workouts over 60 days since 10 Aug.
      ['В середньому / тиж.', '1,2'],
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

  it('is empty for a period without workouts', () => {
    const { tiles, types } = build(freshData()).workouts;
    expect(types).toEqual([]);
    expect(tiles.map((t) => t.value)).toEqual(['0', '0', '0', '0']);
  });
});

describe('buildProgressModel — nutrition', () => {
  it('shows averages, the goal and 7 labelled bars for the week', () => {
    const n = build(progressData()).nutrition;
    expect(n.goal).toBe(`ціль ${f0(1700)} ккал`);
    expect(cells(n.tiles).map((c) => [c[0], c[1]])).toEqual([
      ['Цей тиждень', f0(1650)],
      ['Цей місяць', f0(1625)],
      ['Період', f0(1650)],
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

  it('lists the kcal history newest first, 7 at a time', () => {
    const n = build(progressData()).nutrition;
    expect(n.history).toHaveLength(7);
    expect(n.hasMore).toBe(true);
    expect(n.history.slice(0, 3).map((r) => [r.label, r.value, r.tone, r.href])).toEqual([
      ['8 жовтня', `${f0(1700)} ккал`, 'acc2', '/calendar?date=2026-10-08'],
      ['7 жовтня', `${f0(1500)} ккал`, 'acc2', '/calendar?date=2026-10-07'],
      ['6 жовтня', `${f0(1800)} ккал`, 'acc', '/calendar?date=2026-10-06'],
    ]);
    expect(n.history[0]?.ariaLabel).toBe(`8 жовтня: ${f0(1700)} ккал. Відкрити в календарі`);
    // Same scale as the chart: max(goal × 1.25, largest bar) = 2125.
    expect(n.history[0]?.pct).toBeCloseTo((1700 / 2125) * 100);

    const all = build(progressData(), { historyLimit: 100 }).nutrition;
    expect(all.history).toHaveLength(32);
    expect(all.hasMore).toBe(false);
  });

  it('has an intentional empty state', () => {
    const n = build(freshData()).nutrition;
    expect(n.tiles.map((t) => t.value)).toEqual(['—', '—', '—']);
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
