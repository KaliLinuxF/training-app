import type { FoodItem, Op } from '@legko/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrequentDishes } from './FrequentDishes';

const store = vi.hoisted(() => ({ foods: [] as FoodItem[], commit: vi.fn() }));

vi.mock('@/store/data', () => ({
  useAppData: () => ({ foods: store.foods }),
  commit: store.commit,
}));

const FOODS: FoodItem[] = [
  { name: 'Кава з молоком', portion: '250 мл', kcal: 90, count: 4, lastUsed: '2026-10-08' },
  { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, count: 7, lastUsed: '2026-10-07' },
  { name: 'Яблуко', portion: '', kcal: 80, count: 1, lastUsed: '2026-10-01' },
];

beforeEach(() => {
  store.commit.mockReset();
  store.foods = FOODS;
});

afterEach(cleanup);

/** Chips over local state, so a deleted dish really disappears (like the app store does). */
function Harness({ onCommit, before }: { onCommit?: (op: Op) => boolean; before?: boolean }) {
  const [foods, setFoods] = useState(FOODS);
  const commit = (...ops: Op[]) => {
    const op = ops[0];
    if (!op || op.kind !== 'food.delete') return true;
    if (onCommit && !onCommit(op)) return false;
    setFoods((fs) => fs.filter((f) => f.name !== op.name));
    return true;
  };
  return (
    <div role="dialog">
      {before && <button type="button">До страв</button>}
      <FrequentDishes onAdd={() => undefined} foods={foods} commit={commit} />
    </div>
  );
}

describe('FrequentDishes', () => {
  it('renders ranked chips from the store', () => {
    render(<FrequentDishes onAdd={() => undefined} />);
    expect(screen.getByText('Часті страви')).toBeTruthy();
    const chips = screen.getAllByRole('button', { name: /^Додати / }).map((b) => b.textContent);
    expect(chips).toEqual(['Вівсянка з бананом · 320', 'Кава з молоком · 90', 'Яблуко · 80']);
  });

  it('a chip is named for VoiceOver without the «·»', () => {
    render(<FrequentDishes onAdd={() => undefined} />);
    expect(screen.getAllByRole('button', { name: /^Додати / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Додати «Вівсянка з бананом», 320 ккал',
      'Додати «Кава з молоком», 90 ккал',
      'Додати «Яблуко», 80 ккал',
    ]);
  });

  it('tap adds the dish to the day; its use is only handed over, not committed', () => {
    const onAdd = vi.fn();
    render(<FrequentDishes onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Додати «Вівсянка з бананом», 320 ккал' }));
    expect(onAdd).toHaveBeenCalledWith({
      line: 'Вівсянка з бананом (250 г) — 320 ккал',
      consumed: '',
      kcal: 320,
      photoId: null,
      items: [{ name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 }],
      uses: [{ name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 }],
    });
    // The sheet records `food.use` when the day is saved: a discarded draft counts nothing.
    expect(store.commit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Додати «Яблуко», 80 ккал' }));
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ line: 'Яблуко — 80 ккал', kcal: 80 }));
  });

  it('«Змінити» switches the chips to delete mode', () => {
    const onAdd = vi.fn();
    render(<FrequentDishes onAdd={onAdd} />);
    const toggle = screen.getByRole('button', { name: 'Змінити' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Готово' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Видалити «Кава з молоком» з частих страв' }));
    expect(store.commit).toHaveBeenCalledWith({ kind: 'food.delete', name: 'Кава з молоком' });
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getAllByRole('button', { name: /^Додати / })).toHaveLength(3);
  });

  it('after a delete, focus moves to the next chip, then the previous one, never to <body>', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    const first = screen.getByRole('button', { name: 'Видалити «Вівсянка з бананом» з частих страв' });
    first.focus();
    fireEvent.click(first);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Видалити «Кава з молоком» з частих страв' }),
    );

    const last = screen.getByRole('button', { name: 'Видалити «Яблуко» з частих страв' });
    last.focus();
    fireEvent.click(last);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Видалити «Кава з молоком» з частих страв' }),
    );
  });

  it('when the last dish is deleted the block goes and focus moves to the control before it', () => {
    render(<Harness before />);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    for (const name of ['Вівсянка з бананом', 'Кава з молоком', 'Яблуко']) {
      fireEvent.click(screen.getByRole('button', { name: `Видалити «${name}» з частих страв` }));
    }
    expect(screen.queryByText('Часті страви')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'До страв' }));
  });

  it('a refused delete keeps the dish and the focus', () => {
    render(<Harness onCommit={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    const remove = screen.getByRole('button', { name: 'Видалити «Яблуко» з частих страв' });
    remove.focus();
    fireEvent.click(remove);
    expect(document.activeElement).toBe(remove);
    expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy();
  });

  it('renders nothing without dishes', () => {
    store.foods = [];
    const { container } = render(<FrequentDishes onAdd={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
