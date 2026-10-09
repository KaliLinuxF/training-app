import type { FoodItem } from '@legko/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrequentDishes } from './FrequentDishes';

const store = vi.hoisted(() => ({ foods: [] as FoodItem[], commit: vi.fn() }));

vi.mock('@/store/data', () => ({
  useAppData: () => ({ foods: store.foods }),
  commit: store.commit,
}));

const TODAY = '2026-10-09';

beforeEach(() => {
  store.commit.mockReset();
  store.foods = [
    { name: 'Кава з молоком', portion: '250 мл', kcal: 90, count: 4, lastUsed: '2026-10-08' },
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, count: 7, lastUsed: '2026-10-07' },
    { name: 'Яблуко', portion: '', kcal: 80, count: 1, lastUsed: '2026-10-01' },
  ];
});

afterEach(cleanup);

describe('FrequentDishes', () => {
  it('renders ranked chips from the store', () => {
    render(<FrequentDishes date={TODAY} onAdd={() => undefined} />);
    expect(screen.getByText('Часті страви')).toBeTruthy();
    const chips = screen.getAllByRole('button', { name: /^Додати / }).map((b) => b.textContent);
    expect(chips).toEqual(['Вівсянка з бананом · 320', 'Кава з молоком · 90', 'Яблуко · 80']);
  });

  it('tap adds the dish to the day and records food.use', () => {
    const onAdd = vi.fn();
    render(<FrequentDishes date={TODAY} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Додати Вівсянка з бананом · 320 ккал' }));
    expect(onAdd).toHaveBeenCalledWith({
      line: 'Вівсянка з бананом (250 г) — 320 ккал',
      kcal: 320,
      photoId: null,
      items: [{ name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 }],
    });
    expect(store.commit).toHaveBeenCalledWith({
      kind: 'food.use',
      date: TODAY,
      value: { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Додати Яблуко · 80 ккал' }));
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ line: 'Яблуко — 80 ккал', kcal: 80 }));
  });

  it('«Змінити» switches the chips to delete mode', () => {
    const onAdd = vi.fn();
    render(<FrequentDishes date={TODAY} onAdd={onAdd} />);
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

  it('renders nothing without dishes', () => {
    store.foods = [];
    const { container } = render(<FrequentDishes date={TODAY} onAdd={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
