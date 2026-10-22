import { coachSummary } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { client, empty, item, meals, NOW, overKcal, quiet, steady } from './coach.fixtures';
import {
  calendarHref,
  checkRows,
  DEFAULT_DETAIL_PARAMS,
  detailHref,
  kpiItems,
  parseDetailParams,
} from './clientModel';

const NB = ' ';
const ID = 'c0ac0000000000000000000000000001';

describe('URL parameters of /coach/<id>', () => {
  it('parses tab, days, period and date; invalid values fall back to the defaults', () => {
    expect(parseDetailParams('')).toEqual(DEFAULT_DETAIL_PARAMS);
    expect(parseDetailParams('?tab=calendar&days=30&period=q&date=2026-10-13')).toEqual({
      tab: 'calendar',
      days: 30,
      period: 'q',
      date: '2026-10-13',
    });
    expect(parseDetailParams('tab=settings&days=5&period=year')).toEqual(DEFAULT_DETAIL_PARAMS);
  });

  it('writes only non-default parameters', () => {
    expect(detailHref(ID, DEFAULT_DETAIL_PARAMS)).toBe(`/coach/${ID}`);
    expect(detailHref(ID, { ...DEFAULT_DETAIL_PARAMS, tab: 'nutrition', days: 30 })).toBe(
      `/coach/${ID}?tab=nutrition&days=30`,
    );
    expect(detailHref(ID, { tab: 'progress', days: 7, period: 'month', date: null })).toBe(
      `/coach/${ID}?tab=progress&period=month`,
    );
    expect(calendarHref(ID, DEFAULT_DETAIL_PARAMS, '2026-10-13')).toBe(`/coach/${ID}?tab=calendar&date=2026-10-13`);
    // The other parameters (7 / 30, the Progress period) survive opening a day.
    expect(calendarHref(ID, { tab: 'progress', days: 30, period: 'month', date: null }, '2026-10-12')).toBe(
      `/coach/${ID}?tab=calendar&days=30&period=month&date=2026-10-12`,
    );
    const round = { tab: 'calendar', days: 30, period: 'all', date: '2026-10-01' } as const;
    expect(parseDetailParams(detailHref(ID, round).split('?')[1] ?? '')).toEqual(round);
  });
});

describe('«Огляд» numbers', () => {
  it('shows the weight, the change, the way to the goal, kcal, Б · Ж · В, workouts and records', () => {
    const s = coachSummary(item(client(1, 'olya'), overKcal()), NOW, 7);
    expect(kpiItems(s)).toEqual([
      { label: 'Вага', value: '69,6', unit: 'кг' },
      { label: 'За тиждень', value: '−0,4', unit: 'кг', tone: 'acc2' },
      { label: 'Від старту', value: '−1,6', unit: 'кг', tone: 'acc2' },
      { label: 'До цілі', value: '17%' },
      { label: `Ккал · ціль 1${NB}700`, value: `1${NB}950`, tone: 'acc' },
      { label: 'Б · Ж · В', value: '—', unit: undefined },
      { label: 'Тренування', value: `1${NB}/${NB}3`, tone: undefined },
      { label: 'Записи', value: `7${NB}/${NB}7` },
    ]);
  });

  it('follows the period and shows the macro averages', () => {
    const s = coachSummary(item(client(4, 'sofia'), meals()), NOW, 30);
    const items = kpiItems(s);
    expect(items[1]?.label).toBe('За 30 днів');
    expect(items[5]).toEqual({ label: 'Б · Ж · В', value: '85 · 51 · 178', unit: 'г' });
    expect(items[7]?.value).toBe(`30${NB}/${NB}30`);
  });

  it('tones workouts behind the plan lavender', () => {
    const s = coachSummary(item(client(2, 'marta'), quiet()), NOW, 7);
    expect(kpiItems(s)[6]).toEqual({ label: 'Тренування', value: `0${NB}/${NB}3`, tone: 'acc' });
  });
});

describe('«Що варто перевірити»', () => {
  it('lists each flag with its detail', () => {
    const s = coachSummary(item(client(2, 'marta'), quiet()), NOW, 7);
    expect(checkRows(s, NOW)).toEqual([
      { key: 'no_records', title: '4 дні без записів', sub: 'Останній запис — 9 жовтня' },
      {
        key: 'no_weigh_in',
        title: 'Без зважування',
        sub: 'Зважування за планом — Пн, 12 жовтня · останнє 5 жовтня',
      },
    ]);
  });

  it('says so when there is nothing to check, and that a disabled account is not checked', () => {
    expect(checkRows(coachSummary(item(client(1, 'a'), steady()), NOW, 7), NOW)).toEqual([
      { key: 'none', title: 'Тривожних сигналів немає' },
    ]);
    const disabled = coachSummary(item(client(1, 'a', { status: 'disabled' }), empty()), NOW, 7);
    expect(checkRows(disabled, NOW)).toEqual([{ key: 'disabled', title: 'Акаунт вимкнено — сигнали не рахуються' }]);
  });
});
