import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EstimateCard, EstimateLoading } from './EstimateCard';
import { draftsToItems, sanitizeKcalInput, toDrafts, type DraftItem } from './model';

afterEach(cleanup);

const ITEMS = [
  { name: 'Борщ', portion: '300 г', kcal: 260 },
  { name: 'Хліб житній', portion: '2 скибки', kcal: 160 },
  { name: 'Сметана', portion: '', kcal: 60 },
];

/** Card wired to local state, like FoodAssist does through the reducer. */
function Harness({ onAdd, remaining = 40 }: { onAdd: (items: DraftItem[]) => void; remaining?: number }) {
  const [drafts, setDrafts] = useState(() => toDrafts(ITEMS));
  return (
    <EstimateCard
      drafts={drafts}
      comment="Порції оцінені приблизно."
      preview={null}
      remaining={remaining}
      onEditKcal={(id, text) =>
        setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, kcalText: sanitizeKcalInput(text) } : d)))
      }
      onRemove={(id) => setDrafts((ds) => ds.filter((d) => d.id !== id))}
      onAdd={() => onAdd(drafts)}
      onCancel={() => undefined}
      onRetry={() => undefined}
    />
  );
}

describe('EstimateCard', () => {
  it('lists items with editable kcal and a live total', () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    expect(screen.getByRole('heading', { name: 'Оцінка калорій' })).toBeTruthy();
    expect(screen.getByText('3 позиції · можна виправити')).toBeTruthy();
    expect(screen.getByText('300 г')).toBeTruthy();
    expect(screen.getByText('Порції оцінені приблизно.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Додати 480 ккал' })).toBeTruthy();

    const borsch = screen.getByRole('textbox', { name: 'Борщ ккал' }) as HTMLInputElement;
    expect(borsch.value).toBe('260');
    expect(borsch.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(borsch, { target: { value: '31o' } });
    expect(borsch.value).toBe('31');
    fireEvent.change(borsch, { target: { value: '310' } });
    expect(screen.getByRole('button', { name: 'Додати 530 ккал' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Прибрати «Сметана»' }));
    expect(screen.queryByText('Сметана')).toBeNull();
    expect(screen.getByText('2 позиції · можна виправити')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Додати 470 ккал' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(draftsToItems(onAdd.mock.calls[0]![0] as DraftItem[])).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 310 },
      { name: 'Хліб житній', portion: '2 скибки', kcal: 160 },
    ]);
  });

  it('an emptied kcal field counts as 0', () => {
    render(<Harness onAdd={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Борщ ккал' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Додати 220 ккал' })).toBeTruthy();
  });

  it('shows the remaining budget only when it is low', () => {
    const { unmount } = render(<Harness onAdd={() => undefined} remaining={40} />);
    expect(screen.queryByText(/Сьогодні ще/)).toBeNull();
    unmount();
    render(<Harness onAdd={() => undefined} remaining={4} />);
    expect(screen.getByText('Сьогодні ще 4 підрахунки')).toBeTruthy();
  });

  it('nothing recognised: comment + «Спробувати ще», no add button', () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <EstimateCard
        drafts={[]}
        comment="Схоже, на фото немає їжі."
        preview="data:image/jpeg;base64,AAAA"
        remaining={null}
        onEditKcal={() => undefined}
        onRemove={() => undefined}
        onAdd={() => undefined}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Схоже, на фото немає їжі.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Додати/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Фото їжі' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('EstimateLoading', () => {
  it('announces progress and can be cancelled', () => {
    const onCancel = vi.fn();
    render(<EstimateLoading photo preview={null} onCancel={onCancel} />);
    expect(screen.getByRole('status').textContent).toContain('Рахую калорії…');
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
