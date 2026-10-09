import type { FoodItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  addedMessage,
  buildFoodAdd,
  buildFrequentDishes,
  chipAddLabel,
  chipLabel,
  clampItem,
  COMPOSER_CLOSED,
  composerEdited,
  consumedTail,
  draftsToItems,
  draftsTotal,
  emptyEstimateComment,
  estimateItems,
  formatFoodLine,
  foundMessage,
  openComposer,
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
  const items = [
    { name: 'Борщ', portion: '300 г', kcal: 260 },
    { name: 'Хліб', portion: '1 скибка', kcal: 160 },
  ];

  it('sums the items, carries the photo id and the dishes to record on save', () => {
    expect(buildFoodAdd(items, 'p_123')).toEqual({
      line: 'Борщ (300 г), хліб (1 скибка) — 420 ккал',
      consumed: '',
      kcal: 420,
      photoId: 'p_123',
      items,
      uses: items,
    });
  });

  it('carries the «Що я їла» tail the line replaces', () => {
    expect(buildFoodAdd(items, null, 'борщ і хліб').consumed).toBe('борщ і хліб');
  });
});

describe('composer', () => {
  it('opens pre-filled with the unestimated tail', () => {
    expect(openComposer(COMPOSER_CLOSED, 'борщ, хліб')).toEqual({ open: true, text: 'борщ, хліб', prefill: 'борщ, хліб' });
    expect(openComposer(COMPOSER_CLOSED, '')).toEqual({ open: true, text: '', prefill: '' });
  });

  it('keeps her own text when reopened, refreshes an untouched pre-fill', () => {
    const own = { open: false, text: 'салат', prefill: 'борщ' };
    expect(openComposer(own, 'борщ, хліб')).toEqual({ ...own, open: true });
    const untouched = { open: false, text: 'борщ', prefill: 'борщ' };
    expect(openComposer(untouched, 'борщ, хліб')).toEqual({ open: true, text: 'борщ, хліб', prefill: 'борщ, хліб' });
  });

  it('only an unchanged pre-fill is replaced by the estimate', () => {
    const c = { open: true, text: 'борщ, хліб', prefill: 'борщ, хліб' };
    expect(composerEdited(c)).toBe(false);
    expect(consumedTail(c)).toBe('борщ, хліб');
    expect(consumedTail({ ...c, text: '  борщ, хліб ' })).toBe('борщ, хліб');

    const edited = { ...c, text: 'борщ 300 г, хліб' };
    expect(composerEdited(edited)).toBe(true);
    expect(consumedTail(edited)).toBe('');

    const typed = { open: true, text: 'салат', prefill: '' };
    expect(composerEdited(typed)).toBe(true);
    expect(consumedTail(typed)).toBe('');
    expect(composerEdited({ ...typed, text: '  ' })).toBe(false);
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

  it('chip accessible name: the dish in quotes, no «·» for VoiceOver to read out', () => {
    expect(chipAddLabel({ name: 'Кава з молоком', kcal: 60 })).toBe('Додати «Кава з молоком», 60 ккал');
    expect(chipAddLabel({ name: 'Сирники ', kcal: 1200 })).toBe(`Додати «Сирники», 1${NBSP_GROUP}200 ккал`);
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

  it('announcements for screen readers', () => {
    expect(foundMessage(0, 0)).toBe('Нічого не знайдено');
    expect(foundMessage(1, 80)).toBe('Знайдено 1 позицію, разом 80 ккал');
    expect(foundMessage(3, 385)).toBe('Знайдено 3 позиції, разом 385 ккал');
    expect(foundMessage(5, 1650)).toBe(`Знайдено 5 позицій, разом 1${NBSP_GROUP}650 ккал`);
    expect(addedMessage({ items: [{ name: 'Борщ', portion: '300 г', kcal: 260 }], kcal: 260 })).toBe(
      'Додано «Борщ», 260 ккал',
    );
    const two = [
      { name: 'Борщ', portion: '300 г', kcal: 260 },
      { name: 'Хліб', portion: '', kcal: 125 },
    ];
    expect(addedMessage({ items: two, kcal: 385 })).toBe('Додано 385 ккал');
  });

  it('nothing found: the advice fits what was sent', () => {
    expect(emptyEstimateComment(true)).toBe('Не вдалося знайти їжу на фото — спробуй описати текстом.');
    expect(emptyEstimateComment(false)).toBe('Не вдалося знайти їжу в описі — спробуй сформулювати інакше.');
  });
});
