import { emptyData, normalizeDay, type Meal } from '@legko/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cssRules, cssValue, readCss } from '@/ui/internal/cssSource';
import { DayNutritionCard } from './DayNutritionCard';
import s from './DayNutritionCard.module.css';
import { foodDayModel, PARTIAL_NOTE } from './foodDayModel';

const DATE = '2026-10-14';
/** Text with every kind of space as a plain one. */
const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s/g, ' ');
/** The generated name of a class of the card's stylesheet. */
const cls = (name: string): string => {
  const generated = s[name];
  if (!generated) throw new Error(`no class .${name}`);
  return generated;
};

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: type,
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

function totals(
  meals: Meal[],
  goals = { protein: null, fat: null, carbs: null } as Record<string, number | null>,
) {
  const data = emptyData();
  data.settings.macroGoals = {
    protein: goals.protein ?? null,
    fat: goals.fat ?? null,
    carbs: goals.carbs ?? null,
  };
  if (meals.length)
    data.days[DATE] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals });
  return foodDayModel(data, DATE).totals;
}

const card = () => screen.getByRole('region', { name: 'Підсумок дня' });
/** The <dd> holding the value of `name` (the cell right after its <dt>). */
const valueOf = (name: string): HTMLElement => {
  const dt = within(card()).getByText(name, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${name}`);
  return dd;
};

afterEach(cleanup);

describe('DayNutritionCard', () => {
  it('is the region «Підсумок дня»: kcal against the goal, the goal line, a decorative bar', () => {
    render(<DayNutritionCard totals={totals([meal('a', 'Сніданок', 1240)])} />);
    const region = card();
    expect(region.tagName).toBe('SECTION');
    // Visible «1 240 / 1 700 ккал»; VoiceOver reads «1 240 з 1 700 ккал» instead of the slash.
    const shown = region.querySelector('p > span[aria-hidden="true"]');
    expect(flat(shown?.textContent)).toBe('1 240 / 1 700 ккал');
    const spoken = within(region).getByText(/^1\s240 з 1\s700 ккал$/);
    expect(spoken.className).toBe('visually-hidden');
    expect(spoken.parentElement).toBe(shown?.parentElement);
    expect(flat(within(region).getByText(/^Залишилось/).textContent)).toBe('Залишилось 460 з 1 700 ккал');
    // The bars are decorative (the numbers are text): nothing for assistive tech to announce.
    expect(within(region).queryAllByRole('progressbar')).toHaveLength(0);
    // No macro known, no goal: no Б · Ж · В block.
    expect(region.querySelector('dl')).toBeNull();
  });

  it('macro values: «68 / 90 г» shown, «68 з 90 г» read — the exact markup', () => {
    render(
      <DayNutritionCard
        totals={totals([meal('a', 'Обід', 900, { protein: 68, fat: 41, carbs: 132 })], {
          protein: 90,
          fat: 60,
        })}
      />,
    );
    const protein = valueOf('Білки');
    expect(protein.tagName).toBe('DD');
    expect(protein.innerHTML).toBe(
      '<span aria-hidden="true">68 / 90 г</span><span class="visually-hidden">68 з 90 г</span>',
    );
    expect(valueOf('Жири').textContent).toBe('41 / 60 г41 з 60 г');
    // No goal: just the grams, and no bar in its row.
    expect(valueOf('Вуглеводи').querySelector('[aria-hidden="true"]')?.textContent).toBe('132 г');
    const bars = (name: string) =>
      valueOf(name).nextElementSibling?.querySelectorAll('span[aria-hidden="true"]');
    expect(bars('Білки')?.length).toBeGreaterThan(0);
    expect(bars('Вуглеводи')?.length ?? 0).toBe(0);
    // The bar cell is hidden from assistive tech either way.
    expect(valueOf('Вуглеводи').nextElementSibling?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText(PARTIAL_NOTE)).toBeNull();
  });

  it('over a goal reads «більше цілі»; reached and over get their tones; no red', () => {
    render(
      <DayNutritionCard
        totals={totals([meal('a', 'Обід', 1900, { protein: 96, fat: 60, carbs: 10 })], {
          protein: 90,
          fat: 60,
        })}
      />,
    );
    const over = cls('over');
    const reached = cls('reached');
    const protein = valueOf('Білки');
    expect(protein.textContent).toBe('96 / 90 г96 з 90 г, більше цілі');
    expect(protein.classList.contains(over)).toBe(true);
    expect(valueOf('Жири').classList.contains(reached)).toBe(true);
    expect(valueOf('Жири').classList.contains(over)).toBe(false);
    const carbs = valueOf('Вуглеводи');
    expect(carbs.classList.contains(over) || carbs.classList.contains(reached)).toBe(false);
    // The kcal number above the goal is lavender too.
    expect(
      card()
        .querySelector(`.${cls('kcalValue')}`)
        ?.classList.contains(over),
    ).toBe(true);
    expect(flat(screen.getByText(/^Перевищено/).textContent)).toBe('Перевищено на 200 ккал · ціль 1 700');
    // Lavender, mint and the ink tokens only: nothing red in the card's styles.
    const css = readCss('sheets/record/DayNutritionCard.module.css');
    for (const rule of cssRules(css))
      for (const value of Object.values(rule.decls))
        expect(value).not.toMatch(/#[0-9a-f]{3}|rgb|hsl|oklch|\bred\b/i);
    expect(cssValue(css, '.over', 'color')).toBe('var(--accD)');
    expect(cssValue(css, '.reached', 'color')).toBe('var(--acc2D)');
  });

  it('a partial sum carries the note under the grid', () => {
    render(
      <DayNutritionCard
        totals={totals(
          [meal('a', 'Сніданок', 380, { protein: 12, fat: 9, carbs: 63 }), meal('b', 'Перекус', 80)],
          {
            protein: 90,
            fat: 60,
          },
        )}
      />,
    );
    const note = screen.getByText(PARTIAL_NOTE);
    expect(note.previousElementSibling?.tagName).toBe('DL');
    expect(valueOf('Білки').querySelector('[aria-hidden="true"]')?.textContent).toBe('12 / 90 г');
    expect(valueOf('Жири').querySelector('[aria-hidden="true"]')?.textContent).toBe('9 / 60 г');
    expect(valueOf('Вуглеводи').querySelector('[aria-hidden="true"]')?.textContent).toBe('63 г');
  });

  it('an empty day: «— / 1 700 ккал» (hidden from VoiceOver), the goal line; a macro goal still shows «— / 90 г»', () => {
    render(<DayNutritionCard totals={totals([], { protein: 90 })} />);
    const region = card();
    expect(flat(region.querySelector('p > span[aria-hidden="true"]')?.textContent)).toBe('— / 1 700 ккал');
    expect(region.querySelector('.visually-hidden')?.textContent).not.toMatch(/ккал/);
    expect(flat(within(region).getByText(/^Ціль/).textContent)).toBe('Ціль — 1 700 ккал на день');
    expect(valueOf('Білки').textContent).toBe('— / 90 гще не пораховано, ціль 90 г');
    expect(valueOf('Жири').querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
  });
});
