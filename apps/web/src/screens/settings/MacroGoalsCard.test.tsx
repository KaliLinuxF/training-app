import type { MacroGoals } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { dataActions, useDataStore, useSettings } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { sampleData } from '@/store/test-utils';
import { MacroGoalsCard } from './MacroGoalsCard';

const mocks = vi.hoisted(() => ({
  api: { sendOps: vi.fn(), getData: vi.fn(), importData: vi.fn(), logout: vi.fn() },
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { ...mocks.api, exportUrl: '/api/export' },
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const NONE: MacroGoals = { protein: null, fat: null, carbs: null };
const goals = () => useDataStore.getState().data.settings.macroGoals;
/** Text with every kind of space (f0's no-break spaces) as one plain space. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function Harness({ headingLevel = 'h2' }: { headingLevel?: 'h2' | 'h3' }) {
  return <MacroGoalsCard goals={useSettings().macroGoals} headingLevel={headingLevel} />;
}

function setup(macroGoals: MacroGoals = NONE, headingLevel: 'h2' | 'h3' = 'h2') {
  useDataStore.setState({
    data: sampleData({ settings: { ...sampleData().settings, macroGoals } }),
    sync: { ...initialSyncState(), loaded: true, online: true },
  });
  render(<Harness headingLevel={headingLevel} />);
  return within(screen.getByRole('region', { name: 'Цілі: білки, жири, вуглеводи' }));
}

const field = (card: ReturnType<typeof setup>, what: 'білки' | 'жири' | 'вуглеводи') =>
  card.getByRole<HTMLInputElement>('textbox', { name: `Ціль: ${what}, г на день` });

/** Focus, type, leave: what a tap elsewhere does. */
function typeAndLeave(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(() => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.sendOps.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MacroGoalsCard', () => {
  it('has a title at the level it is given, three labelled gram fields and the note', () => {
    const card = setup({ protein: 90, fat: 60, carbs: null });
    expect(card.getByRole('heading', { level: 2, name: 'Б · Ж · В на день' })).toBeTruthy();
    expect(card.getByText('Білки')).toBeTruthy();
    expect(card.getByText('Жири')).toBeTruthy();
    expect(card.getByText('Вуглеводи')).toBeTruthy();
    const note = card.getByText('Порожнє поле — без цілі.');
    const fields = (['білки', 'жири', 'вуглеводи'] as const).map((what) => field(card, what));
    expect(fields.map((f) => f.value)).toEqual(['90', '60', '']);
    for (const f of fields) {
      expect(f.inputMode).toBe('numeric');
      expect(f.placeholder).toBe('—');
      expect(f.getAttribute('aria-describedby')).toBe(note.id);
      // The visible label is also the field's <label> (a tap on it focuses the field).
      expect(f.labels?.length).toBe(1);
      // «г» after the field is decoration: the name already says «г».
      const unit = f.parentElement?.querySelector('[aria-hidden="true"]');
      expect(unit?.textContent).toBe('г');
    }
    cleanup();
    const pane = setup(NONE, 'h3');
    expect(pane.getByRole('heading', { level: 3, name: 'Б · Ж · В на день' })).toBeTruthy();
  });

  it('saves on blur', () => {
    const card = setup();
    typeAndLeave(field(card, 'жири'), '60');
    expect(goals()).toEqual({ protein: null, fat: 60, carbs: null });
    typeAndLeave(field(card, 'білки'), ' 1 000 ');
    expect(goals()).toEqual({ protein: 1000, fat: 60, carbs: null });
    // The field shows what was saved.
    expect(field(card, 'білки').value).toBe('1000');
  });

  it('saves on Enter (each field is its own form) and keeps the focus there', () => {
    const card = setup();
    const carbs = field(card, 'вуглеводи');
    act(() => carbs.focus());
    fireEvent.change(carbs, { target: { value: '200' } });
    fireEvent.submit(carbs.closest('form') as HTMLFormElement);
    expect(goals()).toEqual({ protein: null, fat: null, carbs: 200 });
    expect(document.activeElement).toBe(carbs);
    expect(new Set(card.getAllByRole('textbox').map((f) => f.closest('form'))).size).toBe(3);
  });

  it('clears a goal with an empty field', () => {
    const card = setup({ protein: 90, fat: 60, carbs: 150 });
    typeAndLeave(field(card, 'білки'), '');
    expect(goals()).toEqual({ protein: null, fat: 60, carbs: 150 });
    typeAndLeave(field(card, 'вуглеводи'), '   ');
    expect(goals()).toEqual({ protein: null, fat: 60, carbs: null });
    expect(field(card, 'вуглеводи').value).toBe('');
  });

  it('refuses anything but 1–1 000 whole grams inline, and saves nothing', () => {
    const card = setup({ protein: 90, fat: null, carbs: null });
    const commit = vi.spyOn(dataActions, 'updateSettings');
    for (const value of ['0', '1001', '12,5', 'багато']) {
      const protein = field(card, 'білки');
      typeAndLeave(protein, value);
      const alert = card.getByRole('alert');
      expect(plain(alert.textContent), value).toBe('Від 1 до 1 000 г');
      expect(protein.getAttribute('aria-invalid')).toBe('true');
      expect(protein.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
      // Her text stays to fix.
      expect(protein.value).toBe(value);
    }
    expect(commit).not.toHaveBeenCalled();
    expect(goals().protein).toBe(90);
    // Typing again clears the error.
    fireEvent.change(field(card, 'білки'), { target: { value: '95' } });
    expect(card.queryByRole('alert')).toBeNull();
  });

  it('writes nothing when the number did not change', () => {
    const card = setup({ protein: 90, fat: null, carbs: null });
    const commit = vi.spyOn(dataActions, 'updateSettings');
    typeAndLeave(field(card, 'білки'), '90');
    typeAndLeave(field(card, 'білки'), '090');
    typeAndLeave(field(card, 'жири'), '');
    expect(commit).not.toHaveBeenCalled();
    expect(field(card, 'білки').value).toBe('90');
  });

  it('follows a goal changed elsewhere (sync) while she is not in the field', () => {
    const card = setup({ protein: 90, fat: null, carbs: null });
    act(() => {
      dataActions.updateSettings((st) => ({ ...st, macroGoals: { ...st.macroGoals, protein: 110 } }));
    });
    expect(field(card, 'білки').value).toBe('110');
  });

  it('keeps what she is typing when the goal changes elsewhere, and saves her number on blur', () => {
    const card = setup({ protein: 90, fat: null, carbs: null });
    const protein = field(card, 'білки');
    fireEvent.focus(protein);
    fireEvent.change(protein, { target: { value: '100' } });
    act(() => {
      dataActions.updateSettings((st) => ({ ...st, macroGoals: { ...st.macroGoals, protein: 110 } }));
    });
    expect(protein.value).toBe('100');
    fireEvent.blur(protein);
    expect(goals().protein).toBe(100);
    expect(protein.value).toBe('100');
  });

  it('a field she only visited does not write its old number over a change from elsewhere', () => {
    const card = setup({ protein: 90, fat: null, carbs: null });
    const protein = field(card, 'білки');
    fireEvent.focus(protein);
    act(() => {
      dataActions.updateSettings((st) => ({ ...st, macroGoals: { ...st.macroGoals, protein: 110 } }));
    });
    expect(protein.value).toBe('90');
    fireEvent.blur(protein);
    expect(goals().protein).toBe(110);
    expect(protein.value).toBe('110');
  });
});
