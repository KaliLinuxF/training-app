import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MealTypeChips, scrollIntoRow } from './MealTypeChips';

afterEach(cleanup);

const TYPES = ['Сніданок', 'Обід', 'Вечеря', 'Перекус'];

function chips(selected = 'Сніданок') {
  render(<MealTypeChips choices={TYPES} selected={selected} onSelect={() => undefined} onAdd={() => null} />);
  const group = screen.getByRole('group', { name: 'Тип прийому їжі' });
  return { group, add: screen.getByRole('button', { name: 'Додати свій тип прийому їжі' }) };
}

describe('MealTypeChips', () => {
  it('«+ Свій» is outside the scrolling chips (it can never scroll out of sight), right after them', () => {
    const { group, add } = chips();
    const scroller = group.parentElement as HTMLElement;
    expect(group.contains(add)).toBe(false);
    expect(scroller.contains(add)).toBe(false);
    // Same line: the scroller, then the button.
    expect(scroller.nextElementSibling).toBe(add);
    expect(add.textContent).toBe('+ Свій');
    expect(add.getAttribute('aria-expanded')).toBe('false');
    // The group holds the choices only.
    expect(Array.from(group.querySelectorAll('button'), (b) => b.textContent)).toEqual(TYPES);
  });
});

/**
 * A row 250px wide (paddings 18 left, 20 right: chips show whole between x 18 and 230) with four chips
 * 100px wide, 8px apart, laid out by `scrollLeft` as a browser would.
 */
function fakeRow(): { row: HTMLDivElement; chip: (i: number) => HTMLElement } {
  const row = document.createElement('div');
  row.style.paddingLeft = '18px';
  row.style.paddingRight = '20px';
  const list: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const chip = document.createElement('button');
    chip.setAttribute('aria-pressed', 'false');
    chip.getBoundingClientRect = () => {
      const left = 18 + i * 108 - row.scrollLeft;
      return {
        left,
        right: left + 100,
        top: 0,
        bottom: 44,
        width: 100,
        height: 44,
        x: left,
        y: 0,
      } as DOMRect;
    };
    row.append(chip);
    list.push(chip);
  }
  row.getBoundingClientRect = () =>
    ({ left: 0, right: 250, top: 0, bottom: 52, width: 250, height: 52, x: 0, y: 0 }) as DOMRect;
  // 18 + 4 × 100 + 3 × 8 + 20.
  Object.defineProperty(row, 'scrollWidth', { value: 462 });
  Object.defineProperty(row, 'scrollLeft', { value: 0, writable: true });
  Object.defineProperty(row, 'clientWidth', { value: 250 });
  document.body.append(row);
  return { row, chip: (i) => list[i] as HTMLElement };
}

describe('scrollIntoRow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves on to the next chip’s start, so the left edge shows a whole chip (no «нок» of «Сніданок»)', () => {
    const { row, chip } = fakeRow();
    // «Вечеря» (234–334) is past the right edge (230): 104px would show it; the next start is 108.
    scrollIntoRow(row, chip(2));
    expect(row.scrollLeft).toBe(108);
    expect(chip(1).getBoundingClientRect().left).toBe(18);
    expect(chip(2).getBoundingClientRect().right).toBeLessThanOrEqual(230);
  });

  it('at the end of the row it scrolls just enough (no chip start left to stop at)', () => {
    const { row, chip } = fakeRow();
    scrollIntoRow(row, chip(3));
    expect(row.scrollLeft).toBe(212);
    expect(chip(3).getBoundingClientRect().right).toBe(230);
  });

  it('a chip in view stays put; one past the left edge comes back to the padding', () => {
    const { row, chip } = fakeRow();
    scrollIntoRow(row, chip(1));
    expect(row.scrollLeft).toBe(0);
    row.scrollLeft = 150;
    scrollIntoRow(row, chip(1));
    expect(row.scrollLeft).toBe(108);
    expect(chip(1).getBoundingClientRect().left).toBe(18);
  });

  it('without layout (jsdom, a hidden row) it does nothing', () => {
    const row = document.createElement('div');
    const chip = document.createElement('button');
    row.append(chip);
    scrollIntoRow(row, chip);
    expect(row.scrollLeft).toBe(0);
  });
});
