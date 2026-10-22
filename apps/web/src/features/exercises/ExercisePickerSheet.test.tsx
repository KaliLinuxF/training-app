import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, EXERCISE_LIBRARY } from '@legko/shared';
import { getAppData } from '@/store/data';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { ExercisePickerSheet, NOTHING_FOUND } from './ExercisePickerSheet';
import { seedStore } from './storeMock';
import { STEP } from './testData';

vi.mock('@/store/sync', async (original) => (await import('./storeMock')).syncModule(original));

beforeAll(() => installMatchMedia());
beforeEach(async () => {
  stubScrollTo();
  const data = emptyData();
  data.exercises = [STEP];
  await seedStore(data);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Host({ mode, onPick, initialQuery }: { mode: 'multi' | 'single'; onPick: (ids: string[]) => void; initialQuery?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Router hook={memoryLocation({ path: '/workouts/new' }).hook}>
      <button type="button" onClick={() => setOpen(true)}>
        Відкрити
      </button>
      <ExercisePickerSheet open={open} mode={mode} onPick={onPick} onClose={() => setOpen(false)} initialQuery={initialQuery} />
    </Router>
  );
}

const picker = (name: string) => screen.getByRole('dialog', { name });
const row = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole('button', { name: new RegExp(`^${name} `) });

describe('ExercisePickerSheet', () => {
  it('multi: rows toggle a ✓ (aria-pressed), «Додати (N)» is disabled at 0 and adds them in the order picked', () => {
    const onPick = vi.fn();
    render(<Host mode="multi" onPick={onPick} />);
    const dialog = picker('Додати вправи');
    const add = within(dialog).getByRole('button', { name: 'Додати (0)' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const rows = within(within(dialog).getByRole('region', { name: 'Вправи' })).getAllByRole('button');
    expect(rows).toHaveLength(EXERCISE_LIBRARY.length + 1);

    fireEvent.click(row(dialog, 'Присідання зі штангою'));
    fireEvent.click(row(dialog, 'Біг'));
    fireEvent.click(row(dialog, 'Жим лежачи'));
    fireEvent.click(row(dialog, 'Жим лежачи')); // off again
    expect(row(dialog, 'Присідання зі штангою').getAttribute('aria-pressed')).toBe('true');
    expect(row(dialog, 'Жим лежачи').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Додати (2)' }));
    expect(onPick).toHaveBeenCalledWith(['lib.back-squat', 'lib.run']);
    expect(screen.queryByRole('dialog')).toBeTruthy(); // still sliding out
  });

  it('a new opening starts with nothing picked and the initial query', () => {
    const onPick = vi.fn();
    const { rerender } = render(<Host mode="multi" onPick={onPick} initialQuery="прис" />);
    let dialog = picker('Додати вправи');
    expect((within(dialog).getByRole('searchbox', { name: 'Пошук вправи' }) as HTMLInputElement).value).toBe('прис');
    fireEvent.click(row(dialog, 'Присідання зі штангою'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Додати (1)' }));
    rerender(<Host mode="multi" onPick={onPick} initialQuery="прис" />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити', hidden: true }));
    dialog = picker('Додати вправи');
    expect(within(dialog).getByRole('button', { name: 'Додати (0)' })).toBeTruthy();
  });

  it('single: a tap picks and closes', () => {
    const onPick = vi.fn();
    render(<Host mode="single" onPick={onPick} />);
    const dialog = picker('Додати вправу');
    expect(within(dialog).queryByRole('button', { name: /^Додати \(/ })).toBeNull();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Пошук вправи' }), { target: { value: 'планка' } });
    const found = within(within(dialog).getByRole('region', { name: 'Вправи' })).getAllByRole('button');
    expect(found.map((b) => b.textContent)).toEqual(['Бічна планка Власна вага · Косі мʼязи', 'Планка Власна вага · Прес']);
    fireEvent.click(row(dialog, 'Планка'));
    expect(onPick).toHaveBeenCalledWith(['lib.plank']);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('search + groups as in the library; nothing found', () => {
    render(<Host mode="multi" onPick={vi.fn()} />);
    const dialog = picker('Додати вправи');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Мої' }));
    const rows = within(within(dialog).getByRole('region', { name: 'Вправи' })).getAllByRole('button');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('моя');
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Пошук вправи' }), { target: { value: 'жим' } });
    expect(within(dialog).getByText(NOTHING_FOUND)).toBeTruthy();
  });

  it('«+ Своя вправа» stacks the editor (name from the empty search); the new exercise is then picked', () => {
    const onPick = vi.fn();
    render(<Host mode="multi" onPick={onPick} />);
    const dialog = picker('Додати вправи');
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Пошук вправи' }), { target: { value: 'Скакалка подвійна' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Своя вправа' }));
    const editor = screen.getByRole('dialog', { name: 'Нова вправа' });
    expect((within(editor).getByRole('textbox', { name: 'Назва' }) as HTMLInputElement).value).toBe('Скакалка подвійна');
    fireEvent.click(within(editor).getByRole('radio', { name: 'Кардіо' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Зберегти' }));
    const created = getAppData().exercises.find((e) => e.name === 'Скакалка подвійна');
    expect(created).toBeTruthy();
    const add = within(picker('Додати вправи')).getByRole('button', { name: 'Додати (1)' });
    fireEvent.click(add);
    expect(onPick).toHaveBeenCalledWith([created!.id]);
  });

  it('single: a new exercise from the editor is picked at once', () => {
    const onPick = vi.fn();
    render(<Host mode="single" onPick={onPick} />);
    const dialog = picker('Додати вправу');
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Своя вправа' }));
    const editor = screen.getByRole('dialog', { name: 'Нова вправа' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Назва' }), { target: { value: 'Йога' } });
    fireEvent.click(within(editor).getByRole('radio', { name: 'Кардіо' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Зберегти' }));
    const created = getAppData().exercises.find((e) => e.name === 'Йога');
    expect(onPick).toHaveBeenCalledWith([created!.id]);
  });
});
