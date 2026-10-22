import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssValue, readCss } from '@/ui/internal/cssSource';
import { NOW, stubClients } from './coach.fixtures';
import { at, renderPage } from './coach.testing';
import { buildClientRows } from './clientsModel';
import { ClientsList, SortSelect } from './ClientsList';

const NB = ' ';

beforeEach(() => at('/coach'));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const list = () => screen.getByRole('region', { name: 'Клієнти' });

describe('ClientsList (phone)', () => {
  it('renders one link row per client with the weight and the period-aware line (7 days)', () => {
    const rows = buildClientRows(stubClients(), NOW, 7);
    renderPage(<ClientsList rows={rows} />);
    const links = within(list()).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(rows.map((r) => `/coach/${r.id}`));
    const olya = links.find((a) => a.textContent?.startsWith('olya'));
    expect(olya?.textContent).toContain('69,6 кг');
    expect(olya?.textContent).toContain(`−0,4 за тиждень · 1${NB}950 / 1${NB}700 ккал · активність сьогодні`);
    const ivan = links.find((a) => a.textContent?.startsWith('ivan'));
    expect(ivan?.textContent).toContain(`Записи 0${NB}/${NB}7 · активність вчора`);
  });

  it('says «за 30 днів» and «/ 30» for 30 days', () => {
    const rows = buildClientRows(stubClients(), NOW, 30);
    renderPage(<ClientsList rows={rows} />);
    const links = within(list()).getAllByRole('link');
    expect(links.find((a) => a.textContent?.startsWith('olya'))?.textContent).toContain(' за 30 днів · ');
    expect(links.find((a) => a.textContent?.startsWith('ivan'))?.textContent).toContain(`Записи 0${NB}/${NB}30`);
  });

  it('says «Ще не входили» once: in the pill, not again in the line', () => {
    const rows = buildClientRows(stubClients(), NOW, 7);
    renderPage(<ClientsList rows={rows} />);
    const petro = within(list())
      .getAllByRole('link')
      .find((a) => a.textContent?.startsWith('petro'));
    expect(petro?.textContent).not.toMatch(/не входили/i);
    const pills = document.getElementById(petro?.getAttribute('aria-describedby') ?? '');
    expect(pills?.textContent).toBe('Ще не входили');
  });

  it('puts the pills outside the link and ties them to it with aria-describedby', () => {
    const rows = buildClientRows(stubClients(), NOW, 7);
    renderPage(<ClientsList rows={rows} />);
    const marta = within(list())
      .getAllByRole('link')
      .find((a) => a.textContent?.startsWith('marta'));
    const id = marta?.getAttribute('aria-describedby') ?? '';
    const pills = document.getElementById(id);
    expect(pills?.textContent).toBe('4 дні без записівБез зважування');
    expect(marta?.contains(pills ?? null)).toBe(false);
    const sofia = within(list())
      .getAllByRole('link')
      .find((a) => a.textContent?.startsWith('sofia'));
    expect(sofia?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('stamps the list as the way back', () => {
    const rows = buildClientRows(stubClients(), NOW, 7);
    renderPage(<ClientsList rows={rows} />);
    fireEvent.click(within(list()).getAllByRole('link')[0] as HTMLElement);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
  });

  it('renders nothing without rows', () => {
    const view = renderPage(<ClientsList rows={[]} />);
    expect(view.container.innerHTML).toBe('');
  });
});

describe('SortSelect (phone)', () => {
  it('is a native 16px select with short options: each writes its first direction, the first one the default', () => {
    const onSortChange = vi.fn();
    renderPage(<SortSelect sort={{ sort: 'kcal', dir: 'desc' }} onSortChange={onSortChange} />);
    const select = screen.getByRole('combobox', { name: 'Сортування' }) as HTMLSelectElement;
    expect(select.value).toBe('kcal');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'За увагою',
      'Імʼя',
      'Вага',
      'Зміна ваги',
      'До цілі',
      'Калорії',
      'Тренування',
      'Записи',
      'Активність',
    ]);
    fireEvent.change(select, { target: { value: 'weight' } });
    expect(onSortChange).toHaveBeenLastCalledWith({ sort: 'weight', dir: 'desc' });
    fireEvent.change(select, { target: { value: 'goalPct' } });
    expect(onSortChange).toHaveBeenLastCalledWith({ sort: 'goalPct', dir: 'asc' });
    fireEvent.change(select, { target: { value: 'attention' } });
    expect(onSortChange).toHaveBeenLastCalledWith({ sort: null, dir: 'asc' });
    const css = readCss('screens/coach/ClientsList.module.css');
    expect(cssValue(css, '.select', 'font-size')).toBe('16px');
    expect(cssValue(css, '.select', 'min-height')).toBe('44px');
  });
});
