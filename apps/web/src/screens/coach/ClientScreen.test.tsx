import type { CoachClientResponse } from '@legko/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route, Switch } from 'wouter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { cssValue, readCss } from '@/ui/internal/cssSource';
import { client, empty, meals, NOW, overKcal, PHOTO_IDS } from './coach.fixtures';
import { at, desktop, freezeClock, location, mockClient, renderPage, settle, signIn } from './coach.testing';
import { ClientScreen } from './ClientScreen';

const SOFIA = client(4, 'sofia', { lastSeenAt: NOW.getTime() - 2 * 3_600_000 });
const sofia = (): CoachClientResponse => ({ client: SOFIA, data: { ...meals(), foods: [] } });

beforeEach(() => {
  freezeClock();
  signIn('admin');
  desktop(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

async function open(path: string, payload: CoachClientResponse = sofia(), state: unknown = { legkoFrom: '/coach' }) {
  at(path, state);
  const spy = mockClient(payload);
  const view = renderPage(
    <Switch>
      <Route path="/coach/:id" component={ClientScreen} />
      <Route path="/">
        <p>Головна</p>
      </Route>
    </Switch>,
  );
  await settle();
  return { spy, view };
}

const WRITE_WORDS = /додати|записати|редагувати|заповнити|зберегти|видалити|^було$|^не було$/i;

/** Nothing on the page can change the client's records. */
function expectReadOnly() {
  const main = document.body;
  expect(main.textContent).not.toMatch(/Додати|\+ Записати|Редагувати день|Заповнити день|Зберегти|Видалити/);
  for (const role of ['checkbox', 'switch', 'textbox', 'spinbutton'] as const)
    expect(screen.queryAllByRole(role)).toHaveLength(0);
  for (const button of screen.queryAllByRole('button')) {
    const name = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.trim();
    expect(name).not.toMatch(WRITE_WORDS);
  }
  expect(screen.queryByRole('group', { name: 'Тренування' })).toBeNull();
}

describe('ClientScreen header', () => {
  it('asks for the client and shows since / activity, the name, «Лише перегляд», the goals and the tabs', async () => {
    const { spy } = await open(`/coach/${SOFIA.id}`);
    expect(spy).toHaveBeenCalledExactlyOnceWith(SOFIA.id);
    expect(screen.getByRole('heading', { level: 1, name: 'sofia' })).toBeTruthy();
    expect(screen.getByText(/^У Home Fit з \d+ \S+ 2026 · активність: сьогодні, \d\d:\d\d$/)).toBeTruthy();
    // On the page background, so not the kit's --paper-filled neutral pill alone: a card fill with a ring.
    const readOnly = screen.getByText('Лише перегляд');
    expect(readOnly.className).toMatch(/readOnly/);
    const css = readCss('screens/coach/ClientScreen.module.css');
    expect(cssValue(css, '.head .readOnly', 'background')).toBe('var(--card)');
    expect(cssValue(css, '.head .readOnly', 'box-shadow')).toBe('inset 0 0 0 1px var(--line)');
    // The default text matcher folds the NO-BREAK SPACE of «1 700» into a plain space.
    expect(screen.getByText('Ціль 62,0 кг · 1 700 ккал на день · Б 90 г · Ж 60 г · 3 тренування на тиждень')).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Назад: Клієнти' });
    expect(back.getAttribute('href')).toBe('/coach');
    const tabs = screen.getByRole('navigation', { name: 'Розділи клієнта' });
    const links = within(tabs).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['Огляд', `/coach/${SOFIA.id}`, 'page'],
      ['Прогрес', `/coach/${SOFIA.id}?tab=progress`, null],
      ['Календар', `/coach/${SOFIA.id}?tab=calendar`, null],
      ['Харчування', `/coach/${SOFIA.id}?tab=nutrition`, null],
    ]);
  });

  it('shows the flag pills of the client', async () => {
    await open(`/coach/${SOFIA.id}`, { client: client(1, 'olya'), data: { ...overKcal(), foods: [] } });
    expect(screen.getAllByText('Калорії +15% за 7 днів').length).toBeGreaterThanOrEqual(1);
  });

  it('says «Ще не входили» once (the pill), not again in the subtitle', async () => {
    const petro = client(6, 'petro', { createdAt: NOW.getTime() - 10 * 86_400_000, lastSeenAt: null });
    await open(`/coach/${petro.id}`, { client: petro, data: { ...empty(), foods: [] } });
    expect(screen.getAllByText(/не входили/i).map((el) => el.textContent)).toEqual(['Ще не входили']);
    expect(screen.getByText(/^У Home Fit з \d+ \S+ 2026$/)).toBeTruthy();
  });

  it('gives neutral status pills on the page background a visible surface', async () => {
    const taras = client(5, 'taras', { status: 'disabled' });
    await open(`/coach/${taras.id}`, { client: taras, data: { ...overKcal(), foods: [] } });
    expect(screen.getByText('Вимкнено').className).toMatch(/onPaper/);
    const css = readCss('screens/coach/FlagPills.module.css');
    expect(cssValue(css, '.pills .onPaper', 'background')).toBe('var(--card)');
  });

  it('shows «Клієнта не знайдено» for a 404 (an admin, a deleted account)', async () => {
    at('/coach/ad00000000000000000000000000000', { legkoFrom: '/coach' });
    vi.spyOn(api.coach, 'client').mockRejectedValue(new ApiError(404, 'not_found', 'Не знайдено'));
    renderPage(<Route path="/coach/:id" component={ClientScreen} />);
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Клієнта не знайдено' })).toBeTruthy();
    expect(screen.getByText('Можливо, акаунт видалили або він став адміністратором.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад: Клієнти' })).toBeTruthy();
  });

  it('leaves for home on a 403 after asking who is signed in', async () => {
    const { authActions } = await import('@/auth/auth');
    const refresh = vi.spyOn(authActions, 'refreshUser').mockResolvedValue();
    at(`/coach/${SOFIA.id}`);
    vi.spyOn(api.coach, 'client').mockRejectedValue(new ApiError(403, 'forbidden', 'Немає доступу'));
    renderPage(
      <Switch>
        <Route path="/coach/:id" component={ClientScreen} />
        <Route path="/">
          <p>Головна</p>
        </Route>
      </Switch>,
    );
    await settle();
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    expect(location()).toBe('/');
    expect(screen.getByText('Головна')).toBeTruthy();
  });
});

describe('ClientScreen panels', () => {
  it('«Огляд»: the numbers, what to check, Вага and Заміри тіла — read-only', async () => {
    await open(`/coach/${SOFIA.id}`);
    expect(screen.getByRole('heading', { level: 2, name: 'Огляд' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Зараз' })).toBeTruthy();
    const check = screen.getByRole('region', { name: 'Що варто перевірити' });
    expect(check.textContent).toContain('Тривожних сигналів немає');
    // Across the width on the desktop, so «Вага» and «Заміри тіла» pair up below it without holes.
    expect(check.className).toMatch(/full/);
    expect(screen.getByRole('region', { name: 'Вага' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Заміри тіла' })).toBeTruthy();
    expectReadOnly();
  });

  it('«Огляд» of a client without records: only the calm card, nothing that repeats it', async () => {
    await open(`/coach/${SOFIA.id}`, { client: client(3, 'ivan'), data: { ...empty(), foods: [] } });
    expect(screen.getByRole('region', { name: 'Ще нічого не записано' }).textContent).toContain(
      'Записи зʼявляться тут, щойно людина почне вести щоденник.',
    );
    expect(screen.getAllByText('Ще нічого не записано')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Зараз' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Що варто перевірити' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Вага' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Заміри тіла' })).toBeNull();
    expect(screen.queryByText('Зважувань ще немає')).toBeNull();
    // The header still carries the flag (in its own words).
    expect(screen.getByText('Жодного запису від реєстрації')).toBeTruthy();
    expectReadOnly();
  });

  it('«Прогрес» is the client’s own ProgressBody grid, never nested in another grid, without record buttons', async () => {
    const { view } = await open(`/coach/${SOFIA.id}?tab=progress`);
    const bar = screen.getByRole('radiogroup', { name: 'Період' });
    const root = bar.closest('[class*="panel"]') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.className).toMatch(/grid/);
    for (let el = root.parentElement; el && el !== view.container; el = el.parentElement)
      expect(el.className).not.toMatch(/grid/);
    expect(root.parentElement).toBe(view.container);
    expect(screen.queryByRole('heading', { level: 1, name: 'Мій прогрес' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Прогрес' })).toBeTruthy();
    expectReadOnly();
  });

  it('«Календар»: the month and the read-only day with its meals and photos from the coach route', async () => {
    await open(`/coach/${SOFIA.id}?tab=calendar&date=2026-10-13`);
    expect(screen.getByRole('heading', { level: 2, name: 'Жовтень 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '13 жовтня 2026' })).toBeTruthy();
    const meals = screen.getByRole('region', { name: 'Прийоми їжі' });
    expect(meals.textContent).toContain('Сніданок · 08:30');
    const imgs = within(meals).getAllByRole('img', { name: 'Фото їжі' });
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(
      PHOTO_IDS.map((p) => `/api/coach/clients/${SOFIA.id}/photos/${p}/thumb`),
    );
    expect(document.body.innerHTML).not.toContain('/api/photos/');
    expect(screen.getByText('Гарний день, багато ходила')).toBeTruthy();
    expectReadOnlyExceptPhotos();
  });

  it('«Харчування»: kcal by day, Б · Ж · В by day and the meal journal', async () => {
    await open(`/coach/${SOFIA.id}?tab=nutrition`);
    expect(screen.getByRole('region', { name: 'Калорії по днях' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Б · Ж · В по днях' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'День',
      'Ккал',
      'БілкиБціль 90',
      'ЖириЖціль 60',
      'ВуглеводиВ',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Журнал харчування' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Відкрити день →' })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }));
    expect(screen.getAllByRole('link', { name: 'Відкрити день →' })).toHaveLength(14);
    expectReadOnly();
  });

  it('the phone scrolls the tab strip (only the strip, never the page) to bring the active tab into view', async () => {
    desktop(false);
    // A 300px strip whose «Харчування» tab sits at 320–420px of its content.
    const isStrip = (el: Element) => el.getAttribute('aria-label') === 'Розділи клієнта';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = isStrip(this)
        ? { left: 0, width: 300 }
        : this.textContent === 'Харчування'
          ? { left: 320, width: 100 }
          : { left: 0, width: 80 };
      return { ...box, top: 0, height: 44, right: box.left + box.width, bottom: 44, x: box.left, y: 0 } as DOMRect;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return isStrip(this) ? 300 : 0;
    });
    const stripScroll = vi.fn();
    const proto = HTMLElement.prototype as Partial<HTMLElement>;
    const hadScrollTo = Object.prototype.hasOwnProperty.call(proto, 'scrollTo');
    const ownScrollTo = proto.scrollTo;
    proto.scrollTo = stripScroll;
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    try {
      await open(`/coach/${SOFIA.id}?tab=nutrition`);
      const strip = screen.getByRole('navigation', { name: 'Розділи клієнта' });
      expect(stripScroll).toHaveBeenCalledOnce();
      expect(stripScroll.mock.contexts[0]).toBe(strip);
      // 320 + 100 + 8 (margin) − 300 = 128.
      expect(stripScroll).toHaveBeenCalledWith({ left: 128 });
      expect(intoView).not.toHaveBeenCalled();
      expect(pageScroll).not.toHaveBeenCalled();
    } finally {
      if (hadScrollTo) proto.scrollTo = ownScrollTo;
      else delete proto.scrollTo;
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('the desktop never scrolls the tab strip or the page on its own', async () => {
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    try {
      await open(`/coach/${SOFIA.id}?tab=nutrition`);
      expect(intoView).not.toHaveBeenCalled();
      expect(pageScroll).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('the phone tab strip shares the width and fades the edge that hides tabs', () => {
    const css = readCss('screens/coach/ClientScreen.module.css');
    expect(cssValue(css, '.tabs', 'align-self')).toBe('stretch');
    expect(cssValue(css, '.tab', 'flex')).toBe('1 0 auto');
    expect(cssValue(css, '.tab', 'min-height')).toBe('44px');
    expect(cssValue(css, '.fadeEnd', 'mask-image')).toContain('transparent');
    expect(cssValue(css, '.fadeStart', 'mask-image')).toContain('transparent');
  });
});

/** The day view's photo thumbnails open the viewer; nothing else is a button there. */
function expectReadOnlyExceptPhotos() {
  for (const button of screen.queryAllByRole('button')) {
    const name = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.trim();
    expect(name).not.toMatch(WRITE_WORDS);
  }
  expect(document.body.textContent).not.toMatch(/Додати|Редагувати день|Заповнити день/);
  expect(screen.queryByRole('group', { name: 'Тренування' })).toBeNull();
}

describe('ClientScreen navigation', () => {
  it('moves between tabs, periods and days by replacing the entry and keeping the back stamp', async () => {
    await open(`/coach/${SOFIA.id}`);
    const length = window.history.length;
    const push = vi.spyOn(window.history, 'pushState');

    fireEvent.click(screen.getByRole('link', { name: 'Календар' }));
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=calendar`);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });

    fireEvent.click(screen.getByRole('button', { name: /^13 жовтня/ }));
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=calendar&date=2026-10-13`);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(screen.getByRole('heading', { level: 2, name: '13 жовтня 2026' })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Прогрес' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Місяць' }));
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=progress&period=month&date=2026-10-13`);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });

    fireEvent.click(screen.getByRole('link', { name: 'Огляд' }));
    fireEvent.click(screen.getByRole('radio', { name: '30 днів' }));
    expect(location()).toBe(`/coach/${SOFIA.id}?days=30&period=month&date=2026-10-13`);

    expect(window.history.length).toBe(length);
    expect(push).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Клієнти' }));
    expect(back).toHaveBeenCalledOnce();
  });

  it('opens a day of «Історія калорій» in this client’s «Календар», keeping the stamp', async () => {
    await open(`/coach/${SOFIA.id}?tab=progress`);
    const length = window.history.length;
    const history = screen.getByRole('group', { name: 'Історія калорій' });
    fireEvent.click(within(history).getAllByRole('button')[0] as HTMLElement);
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=calendar&date=2026-10-13`);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(window.history.length).toBe(length);
  });

  it('«Відкрити день →» of the journal opens that day in «Календар», keeping the stamp', async () => {
    await open(`/coach/${SOFIA.id}?tab=nutrition`);
    const length = window.history.length;
    fireEvent.click(screen.getAllByRole('link', { name: 'Відкрити день →' })[0] as HTMLElement);
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=calendar&date=2026-10-13`);
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(window.history.length).toBe(length);
  });

  it('keeps the chosen period and 7 / 30 across a history-row click and the way back to «Прогрес»', async () => {
    await open(`/coach/${SOFIA.id}?tab=progress&days=30&period=month`);
    expect(screen.getByRole('radio', { name: 'Місяць' }).getAttribute('aria-checked')).toBe('true');
    const history = screen.getByRole('group', { name: 'Історія калорій' });
    fireEvent.click(within(history).getAllByRole('button')[0] as HTMLElement);
    expect(location()).toMatch(new RegExp(`^/coach/${SOFIA.id}\\?tab=calendar&days=30&period=month&date=2026-10-\\d\\d$`));
    fireEvent.click(screen.getByRole('link', { name: 'Прогрес' }));
    expect(screen.getByRole('radio', { name: 'Місяць' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Огляд' }));
    expect(screen.getByRole('radio', { name: '30 днів' }).getAttribute('aria-checked')).toBe('true');
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
  });

  it('keeps 30 days across «Відкрити день →» and the way back to «Харчування»', async () => {
    await open(`/coach/${SOFIA.id}?tab=nutrition&days=30&period=q`);
    fireEvent.click(screen.getAllByRole('link', { name: 'Відкрити день →' })[0] as HTMLElement);
    expect(location()).toBe(`/coach/${SOFIA.id}?tab=calendar&days=30&period=q&date=2026-10-13`);
    fireEvent.click(screen.getByRole('link', { name: 'Харчування' }));
    expect(screen.getByRole('radio', { name: '30 днів' }).getAttribute('aria-checked')).toBe('true');
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
  });

  it('without the stamp (a deep link) the back control replaces the entry with the list', async () => {
    await open(`/coach/${SOFIA.id}`, sofia(), null);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Клієнти' }));
    expect(back).not.toHaveBeenCalled();
    expect(location()).toBe('/coach');
  });
});
