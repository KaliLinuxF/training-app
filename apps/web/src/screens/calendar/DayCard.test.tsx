/** The calendar day card with sessions and steps (§3.14): the static «Було» mark and the «Кроки» row. */
import { emptyData, type AppData } from '@legko/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '@/lib/stats/workouts.testing';
import { installMatchMedia } from '@/ui/internal/testing';
import { DayCard } from './DayCard';
import { buildDayDetail } from './model';

const TODAY = '2026-10-10';
const DATE = '2026-10-08';
const flat = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ');

function card(data: AppData) {
  installMatchMedia();
  const onOpen = vi.fn();
  const onTrained = vi.fn();
  render(<DayCard detail={buildDayDetail(data, DATE, TODAY)} onOpen={onOpen} onTrained={onTrained} reveal={0} />);
  return { onOpen, onTrained };
}

afterEach(() => cleanup());

describe('DayCard: sessions and steps', () => {
  it('a day with a done session shows its lines and the static mark instead of ✓ / ✕', () => {
    const data = emptyData();
    data.days[DATE] = { food: '', kcal: null, trained: true, types: ['Низ тіла'], notes: '' };
    data.sessions = [session({ date: DATE })];
    const { onOpen } = card(data);
    expect(screen.queryByRole('button', { name: 'Було' })).toBeNull();
    expect(screen.getByText('Тренування записано')).toBeTruthy();
    const row = screen.getByRole('button', { name: 'Тренування: було, Ноги + прес' });
    expect(flat(row.textContent)).toMatch(/Ноги \+ прес · 48 хв · \d+ ккал/);
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('workout');
  });

  it('«Кроки»: «Додати» when empty, the count and kcal when logged; it opens the steps sheet', () => {
    const empty = emptyData();
    const { onOpen } = card(empty);
    fireEvent.click(screen.getByRole('button', { name: 'Кроки: додати' }));
    expect(onOpen).toHaveBeenCalledWith('steps');
    cleanup();

    const logged = emptyData();
    logged.steps = [{ date: DATE, steps: 8400 }];
    card(logged);
    const row = screen.getByRole('button', { name: /^Кроки: 8\s400, спалено близько \d+ ккал$/ });
    expect(flat(within(row).getByText(/^≈/).textContent)).toMatch(/^≈ \d+ ккал$/);
    expect(flat(row.textContent)).toContain('8 400');
  });
});
