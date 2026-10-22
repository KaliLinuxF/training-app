import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, OWN_ID_RE, type Exercise } from '@legko/shared';
import { getAppData } from '@/store/data';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { regionsFor } from './bodyMapModel';
import { NAME_REQUIRED, NAME_TAKEN, PRIMARY_REQUIRED } from './editorModel';
import { ExerciseEditorSheet } from './ExerciseEditorSheet';
import { committed, lastBatch, seedStore } from './storeMock';
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

function renderEditor(props: { exercise?: Exercise; initialName?: string } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<ExerciseEditorSheet open onSaved={onSaved} onClose={onClose} {...props} />);
  const dialog = screen.getByRole('dialog', { name: props.exercise ? 'Вправа' : 'Нова вправа' });
  return { dialog, onSaved, onClose };
}

const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
const nameInput = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Назва' });

describe('ExerciseEditorSheet', () => {
  it('names every control: name, kind, muscles (chips + hint), equipment, intensity', () => {
    const { dialog } = renderEditor({ initialName: 'Тест' });
    expect((nameInput(dialog) as HTMLInputElement).value).toBe('Тест');
    expect(within(dialog).getByRole('radiogroup', { name: 'Тип' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'З вагою' }).getAttribute('aria-checked')).toBe('true');
    const muscles = within(dialog).getByRole('group', { name: 'Мʼязи' });
    expect(within(muscles).getAllByRole('button')).toHaveLength(15);
    expect(
      within(dialog).getByText('Торкнись мʼяза: раз — основний, двічі — допоміжний, втретє — прибрати'),
    ).toBeTruthy();
    // The map is decorative in the editor: the chips are the accessible input.
    expect(within(dialog).queryByRole('img')).toBeNull();
    const equipment = within(dialog).getByRole('group', { name: 'Обладнання' });
    expect(within(equipment).getAllByRole('button')).toHaveLength(9);
    expect(within(equipment).getByRole('button', { name: 'Гантелі' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: 'Помірна' }).getAttribute('aria-checked')).toBe('true');
  });

  it('validation: name required, unique (case-insensitive), a primary muscle unless cardio; nothing saved', () => {
    const { dialog, onSaved } = renderEditor();
    save(dialog);
    expect(within(dialog).getByText(NAME_REQUIRED)).toBeTruthy();
    expect(within(dialog).getByText(PRIMARY_REQUIRED)).toBeTruthy();
    expect(nameInput(dialog).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(nameInput(dialog));

    fireEvent.change(nameInput(dialog), { target: { value: 'жим лежачи' } });
    expect(within(dialog).getByText(NAME_TAKEN)).toBeTruthy();
    fireEvent.change(nameInput(dialog), { target: { value: 'степ-аеробіка' } });
    expect(within(dialog).getByText(NAME_TAKEN)).toBeTruthy();
    fireEvent.change(nameInput(dialog), { target: { value: 'Тест-вправа' } });
    expect(within(dialog).queryByText(NAME_TAKEN)).toBeNull();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Кардіо' }));
    expect(within(dialog).queryByText(PRIMARY_REQUIRED)).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'На час' }));
    expect(within(dialog).getByText(PRIMARY_REQUIRED)).toBeTruthy();
    expect(committed.batches).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves a new exercise with a fresh own id and the MET of the intensity, then closes', () => {
    const { dialog, onSaved, onClose } = renderEditor();
    fireEvent.change(nameInput(dialog), { target: { value: '  Тест-вправа ' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Власна вага' }));
    const muscles = within(dialog).getByRole('group', { name: 'Мʼязи' });
    fireEvent.click(within(muscles).getByRole('button', { name: 'Прес' }));
    fireEvent.click(within(muscles).getByRole('button', { name: 'Косі мʼязи' }));
    fireEvent.click(within(muscles).getByRole('button', { name: 'Косі мʼязи · основний' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Власна вага' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Висока' }));
    save(dialog);

    const [op] = lastBatch();
    expect(committed.batches).toHaveLength(1);
    expect(op?.kind).toBe('exercise.put');
    const value = op?.kind === 'exercise.put' ? op.value : null;
    expect(value).toMatchObject({
      name: 'Тест-вправа',
      kind: 'bodyweight',
      primary: ['abs'],
      secondary: ['obliques'],
      equipment: 'bodyweight',
      met: 8,
    });
    expect(value?.id).toMatch(OWN_ID_RE);
    expect(getAppData().exercises.map((e) => e.name)).toContain('Тест-вправа');
    expect(onSaved).toHaveBeenCalledWith(value);
    expect(onClose).toHaveBeenCalled();
  });

  it('a tap on the map cycles that muscle like its chip (and highlights the chip)', () => {
    const { dialog } = renderEditor({ initialName: 'Карта' });
    const svg = dialog.querySelector('svg[data-view="both"]') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 232, right: 220, bottom: 232, x: 0, y: 0, toJSON: () => ({}) });
    const glutes = regionsFor('both').find((r) => r.key === 'back-glutes-left')!;
    act(() => {
      fireEvent.click(svg, { clientX: glutes.centroid[0], clientY: glutes.centroid[1] });
    });
    expect(within(dialog).getByRole('button', { name: 'Сідниці · основний' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(svg, { clientX: glutes.centroid[0], clientY: glutes.centroid[1] });
    expect(within(dialog).getByRole('button', { name: 'Сідниці · допоміжний' })).toBeTruthy();
  });

  it('editing keeps her exercise id and shows «Вправа»', () => {
    const { dialog, onSaved } = renderEditor({ exercise: STEP });
    expect((nameInput(dialog) as HTMLInputElement).value).toBe('Степ-аеробіка');
    fireEvent.change(nameInput(dialog), { target: { value: 'Степ' } });
    save(dialog);
    const [op] = lastBatch();
    expect(op).toMatchObject({ kind: 'exercise.put', value: { id: STEP.id, name: 'Степ', kind: 'cardio', met: 7 } });
    expect(onSaved).toHaveBeenCalled();
    expect(getAppData().exercises).toHaveLength(1);
  });

  it('a refused save (the 301st exercise) keeps the form open with a message', async () => {
    const data = emptyData();
    data.exercises = Array.from({ length: 300 }, (_, i) => ({ ...STEP, id: `ownExercise${String(i).padStart(3, '0')}`, name: `Вправа ${i}` }));
    await seedStore(data);
    const { dialog, onSaved } = renderEditor({ initialName: 'Ще одна' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Кардіо' }));
    save(dialog);
    expect(within(dialog).getByRole('alert').textContent).toContain('Не вдалося зберегти');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
