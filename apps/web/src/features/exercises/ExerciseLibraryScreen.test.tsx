import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXERCISE_LIBRARY } from '@legko/shared';
import { DESKTOP_QUERY } from '@/lib/platform';
import { getAppData } from '@/store/data';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { ExerciseLibraryRoute } from './ExerciseLibraryRoute';
import { ExerciseLibraryScreen, FILTER_STORAGE_KEY, NOTHING_FOUND, PICK_ONE } from './ExerciseLibraryScreen';
import { seedStore } from './storeMock';
import { trainingData } from './testData';

vi.mock('@/store/sync', async (original) => (await import('./storeMock')).syncModule(original));

beforeEach(async () => {
  installMatchMedia();
  stubScrollTo();
  sessionStorage.clear();
  window.history.replaceState(null, '');
  await seedStore(trainingData());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAt(path: string, ui = <ExerciseLibraryRoute />) {
  const memory = memoryLocation({ path, record: true });
  render(<Router hook={memory.hook}>{ui}</Router>);
  return memory;
}

const list = () => screen.getByRole('region', { name: 'Список вправ' });
const rows = () => within(list()).getAllByRole('link');
const search = () => screen.getByRole('searchbox', { name: 'Пошук вправи' });
const group = (name: string) => within(screen.getByRole('group', { name: 'Групи вправ' })).getByRole('button', { name });

describe('ExerciseLibraryScreen (phone)', () => {
  it('«‹ Тренування», the h1 «Вправи», search, 10 group chips and every exercise as a link to its page', () => {
    renderAt('/workouts/library');
    expect(screen.getByRole('heading', { level: 1, name: 'Вправи' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад: Тренування' }).getAttribute('href')).toBe('/workouts');
    expect(within(screen.getByRole('group', { name: 'Групи вправ' })).getAllByRole('button')).toHaveLength(10);
    expect(group('Усі').getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(EXERCISE_LIBRARY.length + 1);
    const squat = within(list()).getByRole('link', { name: 'Присідання зі штангою Штанга · Квадрицепс, сідниці' });
    expect(squat.getAttribute('href')).toBe('/workouts/library/lib.back-squat');
    expect(squat.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('search «прис» (case-insensitive), then a group narrows it; nothing found offers «+ Своя вправа»', () => {
    renderAt('/workouts/library');
    fireEvent.change(search(), { target: { value: 'ПРИС' } });
    const found = rows().map((r) => r.textContent ?? '');
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found.every((t) => t.toLocaleLowerCase('uk').includes('прис'))).toBe(true);
    fireEvent.click(group('Сідниці'));
    expect(group('Сідниці').getAttribute('aria-pressed')).toBe('true');
    expect(rows().map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Сумо-присідання')]),
    );
    fireEvent.change(search(), { target: { value: 'щосьдивне' } });
    expect(screen.getByRole('status').textContent).toBe(NOTHING_FOUND);
    expect(screen.queryByRole('region', { name: 'Список вправ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Своя вправа' }));
    const editor = screen.getByRole('dialog', { name: 'Нова вправа' });
    expect((within(editor).getByRole('textbox', { name: 'Назва' }) as HTMLInputElement).value).toBe('щосьдивне');
  });

  it('groups: «Кардіо» by kind, «Мої» = her own with a «моя» pill', () => {
    renderAt('/workouts/library');
    fireEvent.click(group('Кардіо'));
    expect(rows().length).toBeGreaterThan(5);
    fireEvent.click(group('Мої'));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toBe('Степ-аеробіка Кардіо · Квадрицепс моя');
  });

  it('the filter survives a visit to an exercise page (this tab only)', () => {
    renderAt('/workouts/library');
    fireEvent.change(search(), { target: { value: 'жим' } });
    fireEvent.click(group('Груди'));
    expect(JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY)!)).toEqual({ query: 'жим', group: 'chest' });
    cleanup();
    renderAt('/workouts/library');
    expect((search() as HTMLInputElement).value).toBe('жим');
    expect(group('Груди').getAttribute('aria-pressed')).toBe('true');
    sessionStorage.setItem(FILTER_STORAGE_KEY, '{"query":3,"group":"nope"}');
    cleanup();
    renderAt('/workouts/library');
    expect((search() as HTMLInputElement).value).toBe('');
    expect(group('Усі').getAttribute('aria-pressed')).toBe('true');
  });

  it('«+ Своя вправа» saves a new exercise that then shows under «Мої»', () => {
    renderAt('/workouts/library');
    fireEvent.click(screen.getByRole('button', { name: '+ Своя вправа' }));
    const editor = screen.getByRole('dialog', { name: 'Нова вправа' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Назва' }), { target: { value: 'Тест-вправа' } });
    fireEvent.click(within(within(editor).getByRole('group', { name: 'Мʼязи' })).getByRole('button', { name: 'Литки' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Зберегти' }));
    expect(getAppData().exercises.map((e) => e.name)).toContain('Тест-вправа');
    fireEvent.click(group('Мої'));
    expect(rows().map((r) => r.textContent)).toContain('Тест-вправа Гантелі · Литки моя');
  });

  it('opened from Settings: «‹ Налаштування»', () => {
    window.history.replaceState({ legkoFrom: '/settings/workouts' }, '');
    renderAt('/workouts/library');
    expect(screen.getByRole('link', { name: 'Назад: Налаштування' }).getAttribute('href')).toBe('/settings/workouts');
  });
});

describe('ExerciseLibraryRoute', () => {
  it('phone with an id: the exercise page (h1 = its name, «‹ Вправи»)', () => {
    renderAt('/workouts/library/lib.back-squat');
    expect(screen.getByRole('heading', { level: 1, name: 'Присідання зі штангою' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад: Вправи' }).getAttribute('href')).toBe('/workouts/library');
    expect(screen.queryByRole('region', { name: 'Список вправ' })).toBeNull();
  });

  it('phone: an encoded id is decoded; an unknown one reads «Вправу не знайдено»', () => {
    renderAt('/workouts/library/lib%2Erun');
    expect(screen.getByRole('heading', { level: 1, name: 'Біг' })).toBeTruthy();
    cleanup();
    renderAt('/workouts/library/lib.nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Вправу не знайдено' })).toBeTruthy();
  });

  it('desktop (≥ 900 px, fine pointer): the list with the selected exercise in a pane next to it', () => {
    installMatchMedia((q) => q === DESKTOP_QUERY);
    renderAt('/workouts/library/lib.back-squat');
    expect(screen.getByRole('heading', { level: 1, name: 'Вправи' })).toBeTruthy();
    const pane = screen.getByRole('region', { name: 'Присідання зі штангою' });
    expect(within(pane).getByRole('heading', { level: 2, name: 'Присідання зі штангою' })).toBeTruthy();
    expect(within(pane).getByRole('heading', { level: 3, name: 'Прогрес' })).toBeTruthy();
    const current = within(list()).getByRole('link', { current: 'page' });
    expect(current.getAttribute('href')).toBe('/workouts/library/lib.back-squat');
  });

  it('desktop without an id: the list and a hint in the pane; a row selects', () => {
    installMatchMedia((q) => q === DESKTOP_QUERY);
    const memory = renderAt('/workouts/library');
    expect(screen.getByText(PICK_ONE)).toBeTruthy();
    fireEvent.click(within(list()).getByRole('link', { name: /^Біг / }));
    expect(memory.history?.at(-1)).toBe('/workouts/library/lib.run');
    expect(screen.getByRole('region', { name: 'Біг' })).toBeTruthy();
  });

  it('the screen alone takes a selected id only on desktop', () => {
    renderAt('/workouts/library', <ExerciseLibraryScreen selectedId="lib.run" />);
    expect(screen.queryByRole('region', { name: 'Біг' })).toBeNull();
    expect(within(list()).queryByRole('link', { current: 'page' })).toBeNull();
  });
});
