import { opSchema, type FoodEstimateResponse, type FoodItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { draftsToItems, toDrafts } from './drafts';
import { estimateIdOf, estimateReducer, initialPositions } from './estimate';
import {
  addedMessage,
  buildFrequentDishes,
  chipAddLabel,
  chipLabel,
  clampItem,
  COMPOSER_CLOSED,
  composerEdited,
  consumedTail,
  dishItem,
  emptyEstimateComment,
  estimateItems,
  formatFoodLine,
  foundMessage,
  macroInputText,
  macroPrecise,
  macroShort,
  macrosOf,
  macroWords,
  openComposer,
  parseKcal,
  parseMacroInput,
  pluralUk,
  positionsSubtitle,
  recalculatedMessage,
  remainingHint,
  sanitizeKcalInput,
  sanitizeMacroInput,
} from './model';

const NBSP_GROUP = (1650).toLocaleString('uk-UA').replace(/\d/g, '').charAt(0);
/** The no-break space lib/nutrition keeps inside «Б 24». */
const NB = '\u00A0';

const NO_MACROS = { protein: null, fat: null, carbs: null };

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
    expect(formatFoodLine([{ name: 'Піца', portion: '1/2', kcal: 1650 }])).toBe(
      `Піца (1/2) — 1${NBSP_GROUP}650 ккал`,
    );
  });

  it('a single chip line', () => {
    expect(formatFoodLine([{ name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 }])).toBe(
      'Вівсянка з бананом (250 г) — 320 ккал',
    );
  });
});

describe('composer', () => {
  it('opens pre-filled with the pending tail', () => {
    expect(openComposer(COMPOSER_CLOSED, 'борщ, хліб')).toEqual({
      open: true,
      text: 'борщ, хліб',
      prefill: 'борщ, хліб',
    });
    expect(openComposer(COMPOSER_CLOSED, '')).toEqual({ open: true, text: '', prefill: '' });
  });

  it('keeps her own text when reopened, refreshes an untouched pre-fill', () => {
    const own = { open: false, text: 'салат', prefill: 'борщ' };
    expect(openComposer(own, 'борщ, хліб')).toEqual({ ...own, open: true });
    const untouched = { open: false, text: 'борщ', prefill: 'борщ' };
    expect(openComposer(untouched, 'борщ, хліб')).toEqual({
      open: true,
      text: 'борщ, хліб',
      prefill: 'борщ, хліб',
    });
  });

  it('only an unchanged pre-fill counts the pending tail', () => {
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
});

describe('macro inputs', () => {
  it('keep digits and one separator (comma or dot): 4 whole digits, 1 decimal', () => {
    expect(sanitizeMacroInput('12,5 г')).toBe('12,5');
    expect(sanitizeMacroInput('12.55')).toBe('12.5');
    expect(sanitizeMacroInput('123456')).toBe('1234');
    expect(sanitizeMacroInput('1,2,3')).toBe('1,2');
    expect(sanitizeMacroInput('−8')).toBe('8');
  });

  it('parse to 0.5 g steps within the limit; empty or a bare comma is unknown', () => {
    expect(parseMacroInput('')).toBeNull();
    expect(parseMacroInput(',')).toBeNull();
    expect(parseMacroInput('12,5')).toBe(12.5);
    expect(parseMacroInput('12,3')).toBe(12.5);
    expect(parseMacroInput('12,2')).toBe(12);
    expect(parseMacroInput('0')).toBe(0);
    // One position holds at most 1 000 g; a meal (manual numbers) 3 000 g.
    expect(parseMacroInput('2500')).toBe(1000);
    expect(parseMacroInput('2500', 3000)).toBe(2500);
  });

  it('show a number as she would type it', () => {
    expect(macroInputText(12.5)).toBe('12,5');
    expect(macroInputText(68)).toBe('68');
    expect(macroInputText(0)).toBe('0');
    expect(macroInputText(null)).toBe('');
  });

  it('the row line, the editor line and the spoken words', () => {
    const m = { protein: 24, fat: 7.5, carbs: 31 };
    expect(macroShort(m)).toBe(`Б${NB}24${NB}· Ж${NB}8${NB}· В${NB}31`);
    expect(macroShort({ ...m, fat: null })).toBe(`Б${NB}24${NB}· В${NB}31`);
    expect(macroShort(NO_MACROS)).toBe('');
    expect(macroPrecise(m)).toBe(`Б${NB}24${NB}· Ж${NB}7,5${NB}· В${NB}31${NB}г`);
    expect(macroPrecise({ ...m, carbs: null })).toBe(`Б${NB}24${NB}· Ж${NB}7,5${NB}· В${NB}—${NB}г`);
    expect(macroPrecise(NO_MACROS)).toBeNull();
    expect(macroWords(m)).toBe('білки 24, жири 8, вуглеводи 31 г');
    expect(macroWords({ ...m, protein: null })).toBe('жири 8, вуглеводи 31 г');
    expect(macroWords(NO_MACROS)).toBe('');
  });

  it('a dish without macros has them unknown', () => {
    expect(macrosOf({ protein: 3 })).toEqual({ protein: 3, fat: null, carbs: null });
    expect(macrosOf({})).toEqual(NO_MACROS);
  });
});

describe('estimate normalisation', () => {
  it('clamps values to the op limits, rounds macros to 0.5 g and drops nameless items', () => {
    expect(
      clampItem({
        name: `  ${'а'.repeat(90)}`,
        portion: 'x'.repeat(70),
        kcal: 25000.4,
        protein: 1200,
        fat: 7.3,
        carbs: null,
      }),
    ).toEqual({
      name: 'а'.repeat(80),
      portion: 'x'.repeat(60),
      kcal: 20000,
      protein: 1000,
      fat: 7.5,
      carbs: null,
    });
    expect(
      clampItem({ name: 'Вода', portion: '', kcal: 0, protein: -2, fat: Number.NaN, carbs: 0 }),
    ).toMatchObject({
      protein: 0,
      fat: null,
      carbs: 0,
    });
    expect(
      estimateItems({
        photoId: null,
        items: [
          { name: ' ', portion: '', kcal: 10, ...NO_MACROS },
          { name: 'Яблуко', portion: '1 шт', kcal: 80.6, protein: 0.4, fat: 0.2, carbs: 19.8 },
        ],
        totalKcal: 90,
        comment: '',
      }),
    ).toEqual([{ name: 'Яблуко', portion: '1 шт', kcal: 81, protein: 0.5, fat: 0, carbs: 20 }]);
  });

  it('the macros of an estimate reach the positions and the meal items she saves', () => {
    const res: FoodEstimateResponse = {
      photoId: null,
      items: [
        { name: 'Тост з тунцем', portion: '2 шт', kcal: 310, protein: 24, fat: 8, carbs: 31 },
        { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: null, carbs: 5 },
      ],
      totalKcal: 370,
      comment: '',
    };
    const drafts = toDrafts(estimateItems(res));
    expect(drafts.map((d) => [d.proteinText, d.fatText, d.carbsText])).toEqual([
      ['24', '8', '31'],
      ['3', '', '5'],
    ]);
    expect(draftsToItems(drafts)).toEqual(res.items);
    // Through the reducer too, as the meal editor receives them.
    const start = estimateReducer(initialPositions(), { type: 'start', id: 1, photo: false, counts: null });
    const done = estimateReducer(start, { type: 'resolve', id: 1, res });
    expect(done.drafts.every((d) => d.estimateId === estimateIdOf(1))).toBe(true);
    expect(draftsToItems(done.drafts)).toEqual(res.items);
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
      { ...food('Вівсянка з бананом', 5, '2026-10-02', 320), protein: 9, fat: 6, carbs: 58 },
      food('Яблуко', 3, '2026-10-08'),
      food('Борщ', 1, '2026-10-09'),
    ];
    const chips = buildFrequentDishes(foods, 3);
    expect(chips.map((c) => c.item.name)).toEqual(['Вівсянка з бананом', 'Яблуко', 'Кава']);
    expect(chips[0]).toEqual({
      key: 'вівсянка з бананом',
      item: { name: 'Вівсянка з бананом', portion: '1 порція', kcal: 320, protein: 9, fat: 6, carbs: 58 },
      label: 'Вівсянка з бананом · 320',
    });
    // A dish remembered without macros (older ones, old clients): unknown, never 0.
    expect(chips[1]?.item).toEqual({ name: 'Яблуко', portion: '1 порція', kcal: 100, ...NO_MACROS });
  });

  it('a dish as a position carries the macros it has', () => {
    expect(dishItem({ ...food('Кава', 1, '2026-10-01', 60), protein: 3, carbs: 5 })).toEqual({
      name: 'Кава',
      portion: '1 порція',
      kcal: 60,
      protein: 3,
      fat: null,
      carbs: 5,
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
    expect(positionsSubtitle(2)).toBe('2 позиції · можна виправити');
    expect(positionsSubtitle(5)).toBe('5 позицій · можна виправити');
    expect(positionsSubtitle(21)).toBe('21 позиція · можна виправити');
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
    // Some rows were left out: at most 30 positions in a meal.
    expect(foundMessage(2, 300, true)).toBe('Знайдено 2 позиції, разом 300 ккал. Не більше 30 позицій');
    expect(foundMessage(0, 0, true)).toBe('Нічого не знайдено. Не більше 30 позицій');
    expect(addedMessage({ items: [{ name: 'Борщ', portion: '300 г', kcal: 260 }], kcal: 260 })).toBe(
      'Додано «Борщ», 260 ккал',
    );
    const two = [
      { name: 'Борщ', portion: '300 г', kcal: 260 },
      { name: 'Хліб', portion: '', kcal: 125 },
    ];
    expect(addedMessage({ items: two, kcal: 385 })).toBe('Додано 385 ккал');
    expect(recalculatedMessage(520)).toBe('Перераховано: разом 520 ккал');
    expect(recalculatedMessage(1650)).toBe(`Перераховано: разом 1${NBSP_GROUP}650 ккал`);
  });

  it('nothing found: the advice fits what was sent', () => {
    expect(emptyEstimateComment(true)).toBe('Не вдалося знайти їжу на фото — спробуй описати текстом.');
    expect(emptyEstimateComment(false)).toBe('Не вдалося знайти їжу в описі — спробуй сформулювати інакше.');
  });

  it('the saved items are valid meal positions and the uses valid food.use ops', () => {
    const items = draftsToItems(
      toDrafts([{ name: 'Тост', portion: '2 шт', kcal: 310, protein: 24, fat: 8, carbs: 31 }]),
    );
    const op = {
      kind: 'meal.put',
      date: '2026-10-14',
      value: {
        id: 'abcdefghijkl',
        type: 'Сніданок',
        time: '08:30',
        text: '',
        kcal: 310,
        protein: 24,
        fat: 8,
        carbs: 31,
        items,
      },
    };
    expect(opSchema.safeParse(op).success).toBe(true);
  });
});
