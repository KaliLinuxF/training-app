import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { cssValue, readCss } from '@/ui/internal/cssSource';
import { client, item, meals, NOW, stubClients } from './coach.fixtures';
import { at, renderPage } from './coach.testing';
import { buildClientRows, nextSort, sortRows, type SortState } from './clientsModel';
import { ClientsTable } from './ClientsTable';

const ROWS = buildClientRows(stubClients(), NOW, 7);

function Harness({ onSort }: { onSort?: (s: SortState) => void }) {
  const [sort, setSort] = useState<SortState>({ sort: null, dir: 'asc' });
  return (
    <ClientsTable
      rows={sortRows(ROWS, sort.sort, sort.dir)}
      period={7}
      sort={sort}
      onSort={(key) => {
        const next = nextSort(sort, key);
        setSort(next);
        onSort?.(next);
      }}
    />
  );
}

const table = () => screen.getByRole('table');
const header = (name: RegExp) => screen.getByRole('columnheader', { name });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
/** NO-BREAK SPACEs (digit groups) as plain spaces. */
const unbreak = (text: string | null | undefined): string => (text ?? '').replace(/\u00a0/g, ' ');

beforeEach(() => at('/coach'));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('ClientsTable a11y', () => {
  it('is a captioned table in a focusable region with 9 column headers and a row header per client', () => {
    renderPage(<Harness />);
    const region = screen.getByRole('region', { name: 'Клієнти · за 7 днів' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(region).getByRole('table')).toBe(table());
    const cols = table().querySelectorAll('th[scope="col"]');
    expect(cols).toHaveLength(9);
    for (const th of cols) {
      expect(th.querySelectorAll('button')).toHaveLength(1);
      expect(th.getAttribute('aria-sort')).toBe('none');
    }
    expect(table().querySelectorAll('tbody th[scope="row"]')).toHaveLength(6);
  });

  it('has exactly one link per row: the name, to the client page', () => {
    renderPage(<Harness />);
    for (const [i, row] of bodyRows().entries()) {
      const links = within(row).getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0]?.textContent).toBe(ROWS[i]?.username);
      expect(links[0]?.getAttribute('href')).toBe(`/coach/${ROWS[i]?.id}`);
      expect(links[0]?.closest('th')?.getAttribute('scope')).toBe('row');
    }
  });

  it('shows the pills under the name and the long forms for screen readers', () => {
    renderPage(<Harness />);
    const olya = bodyRows().find((r) => r.textContent?.includes('olya'));
    expect(olya && within(olya).getByText('Калорії +15% за 7 днів')).toBeTruthy();
    expect(olya?.textContent).toContain('калорії 1 950 при цілі 1 700, більше цілі');
    expect(olya?.textContent).toContain('−1,6 від старту');
  });

  it('shows «Кроки» after «Тренування»: the average with the goal muted, a faint «—» without steps', () => {
    renderPage(<Harness />);
    const heads = [...table().querySelectorAll('th[scope="col"]')];
    const steps = header(/^Кроки/);
    expect(heads.indexOf(steps)).toBe(heads.indexOf(header(/^Тренування/)) + 1);
    expect(steps.getAttribute('title')).toBe('середнє за день');
    const col = heads.indexOf(steps) - 1;
    const cellOf = (name: string) => {
      const tr = bodyRows().find((r) => within(r).getByRole('link').textContent === name) as HTMLElement;
      return tr.querySelectorAll('td')[col] as HTMLElement;
    };
    const sofia = cellOf('sofia');
    const shown = sofia.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(unbreak(shown.textContent)).toBe('8 300 / 8 000');
    expect(unbreak(shown.querySelector('[class*="muted"]')?.textContent)).toBe(' / 8 000');
    expect(unbreak(sofia.querySelector('.visually-hidden')?.textContent)).toBe(
      'кроків у середньому 8 300 на день за 7 днів, ціль 8 000',
    );
    const olya = cellOf('olya');
    expect(olya.querySelector('[class*="faint"]')?.textContent).toBe('—');
    fireEvent.click(within(steps).getByRole('button'));
    expect(steps.getAttribute('aria-sort')).toBe('ascending');
    expect(within(bodyRows()[0] as HTMLElement).getByRole('link').textContent).toBe('sofia');
  });

  it('cycles aria-sort with Enter on a header button: ascending → descending → none', () => {
    const onSort = vi.fn();
    renderPage(<Harness onSort={onSort} />);
    const button = () => within(header(/Клієнт/)).getByRole('button');
    button().focus();
    fireEvent.keyDown(button(), { key: 'Enter' });
    expect(header(/Клієнт/).getAttribute('aria-sort')).toBe('ascending');
    expect(table().querySelectorAll('[aria-sort="none"]')).toHaveLength(8);
    expect(within(bodyRows()[0] as HTMLElement).getByRole('link').textContent).toBe('ivan');
    fireEvent.keyDown(button(), { key: 'Enter' });
    expect(header(/Клієнт/).getAttribute('aria-sort')).toBe('descending');
    expect(within(bodyRows()[0] as HTMLElement).getByRole('link').textContent).toBe('taras');
    fireEvent.keyDown(button(), { key: 'Enter' });
    expect(header(/Клієнт/).getAttribute('aria-sort')).toBe('none');
    expect(onSort).toHaveBeenCalledTimes(3);
  });

  it('sorts «Ккал» descending first, by a click as well', () => {
    renderPage(<Harness />);
    fireEvent.click(within(header(/Ккал/)).getByRole('button'));
    expect(header(/Ккал/).getAttribute('aria-sort')).toBe('descending');
    expect(header(/Клієнт/).getAttribute('aria-sort')).toBe('none');
  });
});

describe('ClientsTable row clicks (§5.1)', () => {
  it('a click on the name pushes exactly one entry stamped with legkoFrom /coach', () => {
    const push = vi.spyOn(window.history, 'pushState');
    renderPage(<Harness />);
    const row = bodyRows()[0] as HTMLElement;
    fireEvent.click(within(row).getByRole('link'));
    expect(push).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(window.location.pathname).toBe(`/coach/${ROWS[0]?.id}`);
  });

  it('a click on a numeric cell pushes exactly one entry stamped with legkoFrom /coach', () => {
    const push = vi.spyOn(window.history, 'pushState');
    renderPage(<Harness />);
    const row = bodyRows()[3] as HTMLElement;
    fireEvent.click(row.querySelectorAll('td')[4] as HTMLElement);
    expect(push).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(window.location.pathname).toBe(`/coach/${ROWS[3]?.id}`);
  });

  it('ctrl / meta / shift / middle clicks and a text selection do nothing', () => {
    // jsdom cannot open a new tab: stop the browser's own default action of the modified link click.
    const noDefault = (e: Event) => e.preventDefault();
    document.addEventListener('click', noDefault);
    onTestFinished(() => document.removeEventListener('click', noDefault));
    const push = vi.spyOn(window.history, 'pushState');
    renderPage(<Harness />);
    const cell = (bodyRows()[0] as HTMLElement).querySelectorAll('td')[1] as HTMLElement;
    fireEvent.click(cell, { ctrlKey: true });
    fireEvent.click(cell, { metaKey: true });
    fireEvent.click(cell, { shiftKey: true });
    fireEvent.click(cell, { button: 1 });
    fireEvent.click(within(bodyRows()[0] as HTMLElement).getByRole('link'), { ctrlKey: true });
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '69,6' } as Selection);
    fireEvent.click(cell);
    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/coach');
  });
});

describe('ClientsTable layout (CSS contract)', () => {
  const css = readCss('screens/coach/ClientsTable.module.css');

  it('scrolls inside its own region on both axes with a sticky header row and name column', () => {
    expect(cssValue(css, '.scroller', 'overflow')).toBe('auto');
    expect(cssValue(css, '.scroller', 'max-height', '(min-width: 900px) and (hover: hover) and (pointer: fine)')).toBe(
      'calc(100dvh - 220px)',
    );
    expect(cssValue(css, '.table', 'min-width')).toBe('940px');
    expect(cssValue(css, '.th', 'position')).toBe('sticky');
    expect(cssValue(css, '.th', 'top')).toBe('0');
    expect(cssValue(css, '.th', 'z-index')).toBe('2');
    expect(cssValue(css, '.th', 'background')).toBe('var(--card)');
    expect(cssValue(css, '.corner', 'z-index')).toBe('3');
    expect(cssValue(css, '.nameCell', 'position')).toBe('sticky');
    expect(cssValue(css, '.nameCell', 'left')).toBe('0');
    expect(cssValue(css, '.nameCell', 'z-index')).toBe('1');
    expect(cssValue(css, '.nameCell', 'min-width')).toBe('180px');
    expect(cssValue(css, '.nameCell', 'border-right')).toBe('1px solid var(--line2)');
    expect(cssValue(css, '.row > td', 'height')).toBe('64px');
    expect(cssValue(css, '.row > th', 'height')).toBe('64px');
    expect(cssValue(css, '.row:hover > *', 'background')).toBe('var(--paper)');
    expect(cssValue(css, '.sortButton', 'min-height')).toBe('44px');
  });

  it('is the containing block of the cells’ visually hidden long forms, so they never widen the page', () => {
    // `.visually-hidden` is absolutely positioned: without a positioned region it escapes the region's clipping at
    // its static place in the 940px table (the page scrolled sideways at 900–1099px windows).
    expect(cssValue(css, '.scroller', 'position')).toBe('relative');
    expect(cssValue(css, '.surface', 'position')).toBe('relative');
    expect(cssValue(css, '.surface', 'overflow')).toBe('clip');
  });

  it('lines numeric headers up with their values: the sort glyph goes before the label', () => {
    expect(cssValue(css, '.num .sortButton', 'flex-direction')).toBe('row-reverse');
    expect(cssValue(css, '.num .sortButton', 'justify-content')).toBe('flex-start');
    // th 2 + button 4 = the cells' 6 on the right; corner 8 + button 4 = the name cells' 12 on the left.
    expect(cssValue(css, '.th', 'padding')).toBe('0 2px');
    expect(cssValue(css, '.sortButton', 'padding')).toBe('6px 4px');
    expect(cssValue(css, '.row > td', 'padding')).toBe('10px 6px');
    expect(cssValue(css, '.corner', 'padding-left')).toBe('8px');
    expect(cssValue(css, '.row > .nameCell', 'padding-inline')).toBe('12px 10px');
  });

  it('hints at hidden columns: a right-edge fade and a shadow on the name column once scrolled', () => {
    expect(cssValue(css, '.surface::after', 'pointer-events')).toBe('none');
    expect(cssValue(css, '.surface::after', 'opacity')).toBe('0');
    expect(cssValue(css, '.more::after', 'opacity')).toBe('1');
    expect(cssValue(css, '.scrolled .nameCell', 'box-shadow')).toContain('var(--ink)');
    expect(cssValue(css, '.scrolled .corner', 'box-shadow')).toContain('var(--ink)');
  });
});

describe('ClientsTable scroll hints', () => {
  it('marks the surface while columns hide on the right, and once scrolled from the left', () => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(700);
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    renderPage(<Harness />);
    const region = screen.getByRole('region', { name: 'Клієнти · за 7 днів' });
    const surface = region.parentElement as HTMLElement;
    expect(surface.className).toMatch(/more/);
    expect(surface.className).not.toMatch(/scrolled/);
    region.scrollLeft = 200;
    fireEvent.scroll(region);
    expect(surface.className).toMatch(/scrolled/);
    expect(surface.className).not.toMatch(/more/);
  });

  it('shows no hint when the table fits', () => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(960);
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(960);
    renderPage(<Harness />);
    const surface = screen.getByRole('region', { name: 'Клієнти · за 7 днів' }).parentElement as HTMLElement;
    expect(surface.className).not.toMatch(/more|scrolled/);
  });
});

describe('ClientsTable cells', () => {
  it('shows each set Б · Ж · В goal after its average («Б 85/80 · Ж 51/60 · В 178»), none when unset', () => {
    const data = meals();
    data.settings = { ...data.settings, macroGoals: { protein: 80, fat: 60, carbs: null } };
    const rows = buildClientRows([item(client(4, 'sofia'), data)], NOW, 7);
    renderPage(<ClientsTable rows={rows} period={7} sort={{ sort: null, dir: 'asc' }} onSort={vi.fn()} />);
    const cells = within(bodyRows()[0] as HTMLElement).getAllByRole('cell');
    const kcal = cells[3] as HTMLElement;
    const macros = kcal.querySelector('[class*="macros"]');
    expect(macros?.textContent).toBe('Б 85/80 · Ж 51/60 · В 178');
    // Each piece wraps whole.
    expect(macros?.querySelectorAll('[class*="macro"]:not([class*="macros"])')).toHaveLength(3);

    const unset = meals();
    unset.settings = { ...unset.settings, macroGoals: { protein: null, fat: null, carbs: null } };
    const none = buildClientRows([item(client(4, 'sofia'), unset)], NOW, 7);
    cleanup();
    renderPage(<ClientsTable rows={none} period={7} sort={{ sort: null, dir: 'asc' }} onSort={vi.fn()} />);
    const plain = (within(bodyRows()[0] as HTMLElement).getAllByRole('cell')[3] as HTMLElement).querySelector(
      '[class*="macros"]',
    );
    expect(plain?.textContent).not.toContain('/');
  });

  it('leaves the activity cell «—» when the «Ще не входили» pill already says it', () => {
    renderPage(<Harness />);
    const petro = bodyRows().find((r) => within(r).getByRole('link').textContent === 'petro') as HTMLElement;
    const cells = within(petro).getAllByRole('cell');
    expect(cells.at(-1)?.textContent).toBe('—');
    expect(petro.textContent?.match(/не входили/gi)).toHaveLength(1);
  });
});
