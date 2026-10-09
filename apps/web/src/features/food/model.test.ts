import type { FoodItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  buildFoodAdd,
  buildFrequentDishes,
  chipLabel,
  clampItem,
  draftsToItems,
  draftsTotal,
  estimateItems,
  formatFoodLine,
  parseKcal,
  pluralUk,
  remainingHint,
  sanitizeKcalInput,
  toDrafts,
} from './model';

const NBSP_GROUP = (1650).toLocaleString('uk-UA').replace(/\d/g, '').charAt(0);

describe('formatFoodLine', () => {
  it('joins dishes with portions and the total', () => {
    expect(
      formatFoodLine([
        { name: 'Борщ', portion: '300 г', kcal: 260 },
        { name: 'Хліб', portion: '1 скибка', kcal: 160 },
      ]),
    ).toBe('Борщ (300 г), хліб (1 скибка) — 420 ккал');
  });

  it('omits empty portions, capitalises the first dish and keeps acronyms', () => {
    expect(
      formatFoodLine([
        { name: 'кава з молоком', portion: '', kcal: 60 },
        { name: 'ЛаЛа', portion: ' ', kcal: 0 },
        { name: 'КФС крильця', portion: '4 шт', kcal: 400 },
      ]),
    ).toBe('Кава з молоком, лаЛа, КФС крильця (4 шт) — 460 ккал');
  });

  it('groups thousands like the rest of the app', () => {
    expect(formatFoodLine([{ name: 'Піца', portion: '1/2', kcal: 1650 }])).toBe(`Піца (1/2) — 1${NBSP_GROUP}650 ккал`);
  });

  it('a single chip line', () => {
    expect(formatFoodLine([{ name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 }])).toBe(
      'Вівсянка з бананом (250 г) — 320 ккал',
    );
  });
});

describe('buildFoodAdd', () => {
  it('sums the items and carries the photo id', () => {
    const items = [
      { name: 'Борщ', portion: '300 г', kcal: 260 },
      { name: 'Хліб', portion: '1 скибка', kcal: 160 },
    ];
    expect(buildFoodAdd(items, 'p_123')).toEqual({
      line: 'Борщ (300 г), хліб (1 скибка) — 420 ккал',
      kcal: 420,
      photoId: 'p_123',
      items,
    });
  });
});

describe('kcal input', () => {
  it('keeps at most five digits', () => {
    expect(sanitizeKcalInput('12a3 ')).toBe('123');
    expect(sanitizeKcalInput('1234567')).toBe('12345');
    expect(sanitizeKcalInput('−50')).toBe('50');
  });

  it('parses to a clamped integer, empty → 0', () => {
    expect(parseKcal('')).toBe(0);
    expect(parseKcal('320')).toBe(320);
    expect(parseKcal('99999')).toBe(20000);
    expect(parseKcal('3,5')).toBe(35);
  });

  it('drafts round-trip and total', () => {
    const drafts = toDrafts([
      { name: ' Борщ ', portion: '300 г', kcal: 260 },
      { name: 'Хліб', portion: '', kcal: 160 },
    ]);
    expect(drafts.map((d) => d.kcalText)).toEqual(['260', '160']);
    const edited = [{ ...drafts[0]!, kcalText: '300' }, { ...drafts[1]!, kcalText: '' }];
    expect(draftsTotal(edited)).toBe(300);
    expect(draftsToItems(edited)).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 300 },
      { name: 'Хліб', portion: '', kcal: 0 },
    ]);
  });
});

describe('estimate normalisation', () => {
  it('clamps values to the op limits and drops nameless items', () => {
    expect(clampItem({ name: `  ${'а'.repeat(90)}`, portion: 'x'.repeat(70), kcal: 25000.4 })).toEqual({
      name: 'а'.repeat(80),
      portion: 'x'.repeat(60),
      kcal: 20000,
    });
    expect(
      estimateItems({
        photoId: null,
        items: [
          { name: ' ', portion: '', kcal: 10 },
          { name: 'Яблуко', portion: '1 шт', kcal: 80.6 },
        ],
        totalKcal: 90,
        comment: '',
      }),
    ).toEqual([{ name: 'Яблуко', portion: '1 шт', kcal: 81 }]);
  });
});

describe('frequent dishes', () => {
  const food = (name: string, count: number, lastUsed: string, kcal = 100): FoodItem => ({
    name,
    portion: '1 порція',
    kcal,
    count,
    lastUsed,
  });

  it('ranks by count, then recency, and keeps the top N', () => {
    const foods = [
      food('Кава', 3, '2026-10-01'),
      food('Вівсянка з бананом', 5, '2026-10-02', 320),
      food('Яблуко', 3, '2026-10-08'),
      food('Борщ', 1, '2026-10-09'),
    ];
    const chips = buildFrequentDishes(foods, 3);
    expect(chips.map((c) => c.item.name)).toEqual(['Вівсянка з бананом', 'Яблуко', 'Кава']);
    expect(chips[0]).toEqual({
      key: 'вівсянка з бананом',
      item: { name: 'Вівсянка з бананом', portion: '1 порція', kcal: 320 },
      label: 'Вівсянка з бананом · 320',
    });
  });

  it('defaults to ten chips', () => {
    const foods = Array.from({ length: 14 }, (_, i) => food(`Страва ${i}`, i + 1, '2026-10-01'));
    expect(buildFrequentDishes(foods)).toHaveLength(10);
  });

  it('chip label', () => {
    expect(chipLabel({ name: 'Сирники', kcal: 1200 })).toBe(`Сирники · 1${NBSP_GROUP}200`);
  });
});

describe('copy helpers', () => {
  it('Ukrainian plurals', () => {
    const p = (n: number) => pluralUk(n, 'позиція', 'позиції', 'позицій');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111].map(p)).toEqual([
      'позиція',
      'позиції',
      'позиції',
      'позицій',
      'позицій',
      'позицій',
      'позицій',
      'позиція',
      'позиції',
      'позицій',
      'позицій',
    ]);
  });

  it('remaining budget hint only at 10 or fewer', () => {
    expect(remainingHint(null)).toBeNull();
    expect(remainingHint(11)).toBeNull();
    expect(remainingHint(10)).toBe('Сьогодні ще 10 підрахунків');
    expect(remainingHint(3)).toBe('Сьогодні ще 3 підрахунки');
    expect(remainingHint(1)).toBe('Сьогодні ще 1 підрахунок');
    expect(remainingHint(0)).toBe('Ліміт підрахунків на сьогодні вичерпано');
  });
});
