/**
 * «Клієнти» — the admin as a coach, read-only (docs/coach-cabinet.md §6, §8.2): the navigation entry (admins only),
 * the list with its cells, pills, filter, period and sort, a client page with its tabs, the read-only day with its
 * photos served through the coach route, the back stamp that brings the list back with its query, the phone
 * layout without side scroll, and (docs/workouts-steps-rebrand.md §3.18) the «Кроки» column, the «Тренування» tab
 * and the day's steps and sessions — all read-only.
 *
 * Rules: anna and admin are never changed; clients are throwaway accounts (`seedClient`) named with a unique tag
 * and disposed in `finally`. The server clock is real while the browser's is fixed, so `createdAt` / `lastSeenAt`
 * wording and the `inactive` flag are never asserted (unit-tested instead). Photos are stubbed with `FOOD_JPEG`.
 */
import type { Page, Request } from '@playwright/test';
import { coachEmpty, coachMeals, coachOverKcal, coachQuiet, coachTraining } from './fixtures/coach';
import { seedClient, stubCoachPhotos } from './support/coachApi';
import {
  backToClients,
  clientLink,
  clientRow,
  clientsRegion,
  clientTab,
  clientTabs,
  columnHeader,
  dayView,
  sessionGroup,
  expectNoSideScroll,
  filterChip,
  navHasClients,
  openClient,
  openClients,
  search,
  setDays,
  showFilter,
  sortBy,
} from './support/coachUi';
import { BASE_URL } from './support/env';
import { FOOD_JPEG } from './support/food';
import type { Playwright, ServerApi, TestUser } from './support/server';
import { expect, test } from './support/test';

/** A username fragment no other account has: every client of one test carries it. */
const newTag = (): string => `k${Date.now().toString(36)}`;

interface Clients {
  tag: string;
  over: TestUser;
  quiet: TestUser;
  meals: TestUser;
  empty: TestUser;
  all: TestUser[];
}

/** Four throwaway clients (over kcal, quiet, meals with photos, nothing yet), all named with one tag. */
async function seedFour(playwright: Playwright, admin: ServerApi): Promise<Clients> {
  const tag = newTag();
  const all: TestUser[] = [];
  try {
    const over = await seedClient(playwright, admin, coachOverKcal(), `${tag}o`);
    all.push(over);
    const quiet = await seedClient(playwright, admin, coachQuiet(), `${tag}q`);
    all.push(quiet);
    const meals = await seedClient(playwright, admin, coachMeals(), `${tag}m`);
    all.push(meals);
    const empty = await seedClient(playwright, admin, coachEmpty(), `${tag}e`);
    all.push(empty);
    return { tag, over, quiet, meals, empty, all };
  } catch (error) {
    await disposeAll(all);
    throw error;
  }
}

async function disposeAll(users: readonly TestUser[]): Promise<void> {
  for (const user of users) await user.dispose();
}

/** Every request the page makes from now on that the coach must never send. */
function watchWrites(page: Page): { coachWrites: string[]; ops: string[]; ownPhotos: string[] } {
  const seen = { coachWrites: [] as string[], ops: [] as string[], ownPhotos: [] as string[] };
  page.on('request', (r: Request) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/api/coach') && r.method() !== 'GET') seen.coachWrites.push(`${r.method()} ${pathname}`);
    if (pathname === '/api/ops') seen.ops.push(pathname);
    if (pathname.startsWith('/api/photos/')) seen.ownPhotos.push(pathname);
  });
  return seen;
}

const historyLength = (page: Page): Promise<number> => page.evaluate(() => window.history.length);

/** Nothing in the page content can change her records: no inputs, no write words, no links into her pages. */
async function expectNothingEditable(page: Page, what: string): Promise<void> {
  const main = page.getByRole('main');
  for (const role of ['checkbox', 'switch', 'textbox', 'spinbutton'] as const)
    await expect(main.getByRole(role), `${what}: ${role}`).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Додати|Записати|Почати|Продовжити|Зберегти|Видалити|Змінити/ })).toHaveCount(0);
  await expect(main.locator('a[href^="/workouts"]')).toHaveCount(0);
}
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 900;

test.describe('who sees «Клієнти»', () => {
  test('anna has no «Клієнти» and /coach sends her home', async ({ app, page }) => {
    await app.goto('/');
    expect(await navHasClients(page)).toBe(false);
    await page.goto('/coach');
    await expect(page).toHaveURL(/\/$/);
    await expect(app.heading('Головна')).toBeVisible();
    await page.goto('/coach/c0ac0000000000000000000000000001');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the admin as a coach', () => {
  test.use({ account: 'admin' });

  test('«Клієнти» is in the navigation (in place of «Прогрес» on the phone); no «Записати день» there', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    expect(await navHasClients(page)).toBe(true);
    const progress = app.nav.getByRole('link', { name: 'Прогрес', exact: true });
    if (isPhone(page)) await expect(progress).toHaveCount(0);
    else await expect(progress).toHaveCount(1);
    // «+» / «+ Записати день» writes into the admin's own diary: offered on her own pages, not on the coach's.
    const record = page.getByRole('button', { name: /Записати день$/ });
    await expect(record).toHaveCount(1);
    await app.nav.getByRole('link', { name: 'Клієнти', exact: true }).click();
    await expect(page).toHaveURL(/\/coach$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Клієнти', exact: true })).toBeVisible();
    await expect(record).toHaveCount(0);
    await page.goto(`/coach/c0ac0000000000000000000000000001`);
    await expect(page.getByRole('heading', { level: 1, name: 'Клієнта не знайдено' })).toBeVisible();
    await expect(record).toHaveCount(0);
  });

  test('the list: cells, pills, filter, period and sort', async ({ page, playwright, admin }) => {
    const c = await seedFour(playwright, admin);
    try {
      const writes = watchWrites(page);
      await openClients(page, `?q=${c.tag}`);
      await expect(page.getByRole('searchbox', { name: 'Пошук за імʼям' })).toHaveValue(c.tag);
      for (const user of c.all) await expect(clientLink(page, user.creds.username)).toBeVisible();
      await expect(clientsRegion(page).getByRole('link')).toHaveCount(4);

      await expect(clientRow(page, c.over.creds.username)).toContainText('Калорії +15% за 7 днів');
      await expect(clientRow(page, c.quiet.creds.username)).toContainText('4 дні без записів');
      await expect(clientRow(page, c.quiet.creds.username)).toContainText('Без зважування');
      // Just created, nothing recorded, no flag yet: the neutral «Новий клієнт» (the lavender flag has its own words).
      await expect(clientRow(page, c.empty.creds.username)).toContainText('Новий клієнт');
      await expect(clientRow(page, c.meals.creds.username)).not.toContainText('Калорії +');

      // The two flagged clients come first (attention order), and the filter keeps only them. (The chip counts and
      // «з N» count every client of the server, anna included, so only their shape is checked.)
      await expect(clientsRegion(page).getByRole('link').nth(0)).toHaveAccessibleName(
        new RegExp(`^(${c.quiet.creds.username}|${c.over.creds.username})`),
      );
      await showFilter(page, 'Потребують уваги');
      await expect(page).toHaveURL(/show=attention/);
      await expect(clientsRegion(page).getByRole('link')).toHaveCount(2);
      await expect(filterChip(page, 'Потребують уваги')).toHaveText(/^Потребують уваги · \d+$/);
      await expect(page.getByText(/^Показано 2 з \d+$/)).toBeAttached();
      await showFilter(page, 'Усі');
      await expect(clientsRegion(page).getByRole('link')).toHaveCount(4);

      await search(page, `${c.tag}q`);
      await expect(clientsRegion(page).getByRole('link')).toHaveCount(1);
      await search(page, c.tag);

      // 7 / 30 days.
      await setDays(page, 30);
      await expect(page).toHaveURL(/days=30/);
      await expect(page.getByText(/тренування — за 30 днів; сигнали — за останні 7 днів\.$/)).toBeVisible();
      if (isPhone(page)) {
        await expect(clientLink(page, c.over.creds.username)).toHaveAccessibleName(/за 30 днів/);
      } else {
        await expect(columnHeader(page, 'Ккал · 30 дн.')).toBeVisible();
        await expect(columnHeader(page, 'За 30 днів')).toBeVisible();
      }
      // The kcal pill always speaks of the last 7 days.
      await expect(clientRow(page, c.over.creds.username)).toContainText('Калорії +15% за 7 днів');
      await setDays(page, 7);

      // Sort by kcal: the over-the-goal client first.
      if (isPhone(page)) {
        await sortBy(page, 'Калорії');
        await expect(page).toHaveURL(/sort=kcal&dir=desc/);
        await expect(clientsRegion(page).getByRole('link').first()).toHaveAccessibleName(
          new RegExp(`^${c.over.creds.username}`),
        );
        await sortBy(page, 'За увагою');
        await expect(page).not.toHaveURL(/sort=/);
      } else {
        const kcal = columnHeader(page, 'Ккал');
        await expect(kcal).toHaveAttribute('aria-sort', 'none');
        await sortBy(page, 'Ккал');
        await expect(kcal).toHaveAttribute('aria-sort', 'descending');
        await expect(page).toHaveURL(/sort=kcal&dir=desc/);
        await expect(clientsRegion(page).getByRole('link').first()).toHaveText(c.over.creds.username);
        await sortBy(page, 'Ккал');
        await expect(kcal).toHaveAttribute('aria-sort', 'ascending');
        await sortBy(page, 'Ккал');
        await expect(kcal).toHaveAttribute('aria-sort', 'none');
        await expect(page).not.toHaveURL(/sort=/);

        // Keyboard: Enter on the «Клієнт» header cycles it as well.
        const name = columnHeader(page, 'Клієнт');
        await name.getByRole('button').focus();
        await page.keyboard.press('Enter');
        await expect(name).toHaveAttribute('aria-sort', 'ascending');
        await page.keyboard.press('Enter');
        await expect(name).toHaveAttribute('aria-sort', 'descending');
        await page.keyboard.press('Enter');
        await expect(name).toHaveAttribute('aria-sort', 'none');
      }

      expect(writes.coachWrites).toEqual([]);
      expect(writes.ops).toEqual([]);
    } finally {
      await disposeAll(c.all);
    }
  });

  test('a client page: header, tabs, read-only panels, the day with its photos, and the way back', async ({
    page,
    playwright,
    admin,
  }) => {
    const c = await seedFour(playwright, admin);
    try {
      const writes = watchWrites(page);
      const photos = await stubCoachPhotos(page, FOOD_JPEG);
      const query = `?q=${c.tag}&sort=kcal&dir=desc`;
      await openClients(page, query);
      const meals = c.meals.creds.username;
      await openClient(page, meals);
      await expect(page).toHaveURL(new RegExp(`/coach/${c.meals.id}$`));
      const length = await historyLength(page);

      // Header.
      await expect(page.getByText('Лише перегляд')).toBeVisible();
      await expect(page.getByText(/^Ціль 62,0 кг · 1\s700 ккал на день · Б 90 г · Ж 60 г · 3 тренування на тиждень$/)).toBeVisible();
      await expect(clientTabs(page).getByRole('link')).toHaveText([
        'Огляд',
        'Прогрес',
        'Календар',
        'Харчування',
        'Тренування',
      ]);
      await expect(clientTabs(page).getByRole('link', { name: 'Огляд' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('region', { name: 'Що варто перевірити' })).toContainText('Тривожних сигналів немає');
      await expect(page.getByRole('region', { name: 'Вага' })).toBeVisible();

      // «Прогрес»: the client's own cards, nothing to record.
      await clientTab(page, 'Прогрес');
      await expect(page).toHaveURL(/tab=progress/);
      await expect(page.getByRole('region', { name: 'Заміри тіла' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Мій прогрес' })).toHaveCount(0);
      // Inside the page content only: the shell's own record control is checked in the navigation test.
      await expect(page.getByRole('main').getByRole('button', { name: /Записати/ })).toHaveCount(0);

      // «Календар»: pick 13 October, the meals and their photos from the coach route.
      await clientTab(page, 'Календар');
      await page.getByRole('button', { name: /^13 жовтня/ }).click();
      await expect(page).toHaveURL(new RegExp(`/coach/${c.meals.id}\\?tab=calendar&date=2026-10-13$`));
      const day = dayView(page);
      await expect(day).toHaveAccessibleName('13 жовтня 2026');
      const mealList = page.getByRole('region', { name: 'Прийоми їжі' });
      await expect(mealList).toContainText('Сніданок · 08:30');
      await expect(mealList).toContainText('Обід · 13:10');
      await expect(mealList).toContainText('Вечеря · 19:00');
      await expect(mealList.getByRole('img', { name: 'Фото їжі' })).toHaveCount(2);
      await mealList.getByRole('img', { name: 'Фото їжі' }).first().scrollIntoViewIfNeeded();
      await expect.poll(() => photos.length).toBeGreaterThan(0);
      await expect(day).toContainText('Кардіо');
      await expect(page.getByRole('main').getByText(/додати/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Редагувати день|Заповнити день/ })).toHaveCount(0);
      for (const url of photos) expect(new URL(url).pathname).toMatch(new RegExp(`^/api/coach/clients/${c.meals.id}/photos/`));
      expect(writes.ownPhotos).toEqual([]);

      // «Харчування»: 30 days, then «Відкрити день →» keeps them for the way back to this tab.
      await clientTab(page, 'Харчування');
      await expect(page.getByRole('table', { name: 'Б · Ж · В по днях' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Журнал харчування' })).toBeVisible();
      await setDays(page, 30);
      await page.getByRole('link', { name: 'Відкрити день →' }).first().click();
      await expect(page).toHaveURL(/tab=calendar/);
      await expect(page).toHaveURL(/days=30/);
      await clientTab(page, 'Харчування');
      await expect(
        page.getByRole('radiogroup', { name: 'Період' }).getByRole('radio', { name: '30 днів' }),
      ).toHaveAttribute('aria-checked', 'true');

      // Tabs and the day replaced the entry and kept the stamp: «‹ Клієнти» pops back to the list with its query.
      expect(await historyLength(page)).toBe(length);
      await backToClients(page).click();
      await expect(page).toHaveURL(`${BASE_URL}/coach${query}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Клієнти', exact: true })).toBeVisible();
      expect(await historyLength(page)).toBe(length);
      if (!isPhone(page)) await expect(columnHeader(page, 'Ккал')).toHaveAttribute('aria-sort', 'descending');

      expect(writes.coachWrites).toEqual([]);
      expect(writes.ops).toEqual([]);
    } finally {
      await disposeAll(c.all);
    }
  });

  test('the back stamp survives a tab switch and a day pick', async ({ page, playwright, admin }) => {
    const c = await seedFour(playwright, admin);
    try {
      const query = `?q=${c.tag}&sort=kcal&dir=desc`;
      await openClients(page, query);
      await openClient(page, c.over.creds.username);
      const length = await historyLength(page);
      await clientTab(page, 'Календар');
      await page.getByRole('button', { name: /^12 жовтня/ }).click();
      await expect(page).toHaveURL(/date=2026-10-12/);
      expect(await page.evaluate(() => (window.history.state as { legkoFrom?: string } | null)?.legkoFrom)).toBe(
        '/coach',
      );
      expect(await historyLength(page)).toBe(length);
      await backToClients(page).click();
      await expect(page).toHaveURL(`${BASE_URL}/coach${query}`);
      expect(await historyLength(page)).toBe(length);
    } finally {
      await disposeAll(c.all);
    }
  });

  test('workouts and steps: the «Кроки» column, «Тренування» and the day — read-only, no side scroll', async ({
    page,
    playwright,
    admin,
  }) => {
    const tag = newTag();
    const all: TestUser[] = [];
    try {
      // coachTraining: steps 7 200 · 9 100 · 10 500 · 6 400 · 8 300 on 8–13 Oct (avg 8 300, goal 8 000), sessions
      // «Ноги + прес» 12 and 7 Oct, «Верх тіла» 9 Oct. The second client walks 2 000 more every day (avg 10 300).
      const base = await seedClient(playwright, admin, coachTraining(), `${tag}t`);
      all.push(base);
      const moreData = coachTraining();
      moreData.steps = moreData.steps.map((s) => ({ ...s, steps: s.steps + 2000 }));
      const more = await seedClient(playwright, admin, moreData, `${tag}s`);
      all.push(more);
      const writes = watchWrites(page);

      // The list: «Кроки» sorts fewest first, then the most first.
      await openClients(page, `?q=${tag}`);
      await expect(clientsRegion(page).getByRole('link')).toHaveCount(2);
      await expectNoSideScroll(page, 'clients list with steps');
      if (isPhone(page)) {
        await sortBy(page, 'Кроки');
        await expect(page).toHaveURL(/sort=steps&dir=asc/);
        await expect(clientsRegion(page).getByRole('link').first()).toHaveAccessibleName(
          new RegExp(`^${base.creds.username}`),
        );
      } else {
        const steps = columnHeader(page, 'Кроки');
        await expect(steps).toHaveAttribute('title', 'середнє за день');
        await expect(clientRow(page, base.creds.username)).toContainText('8 300 / 8 000');
        await expect(clientRow(page, more.creds.username)).toContainText('10 300 / 8 000');
        await sortBy(page, 'Кроки');
        await expect(steps).toHaveAttribute('aria-sort', 'ascending');
        await expect(page).toHaveURL(/sort=steps&dir=asc/);
        await expect(clientsRegion(page).getByRole('link').first()).toHaveText(base.creds.username);
        await sortBy(page, 'Кроки');
        await expect(steps).toHaveAttribute('aria-sort', 'descending');
        await expect(clientsRegion(page).getByRole('link').first()).toHaveText(more.creds.username);
      }

      // «Тренування»: the schedule, the strip, the sessions with their sets and kcal; 30 days shows all three.
      await openClient(page, base.creds.username);
      await clientTab(page, 'Тренування');
      await expect(page).toHaveURL(/tab=workouts/);
      const week = page.getByRole('region', { name: 'За тиждень', exact: true });
      await expect(week).toContainText('Розклад: Пн, Ср — Ноги + прес · Пт — Верх тіла');
      await expect(week).toContainText(/Кроки, сер\.\s*8\s300\s*\/\s8\s000/);
      const latest = sessionGroup(page, '12 жовтня · Ноги + прес');
      await expect(latest).toContainText(/48\sхв · ≈\s\d+\sккал/);
      await expect(latest).toContainText('Присідання зі штангою');
      await expect(latest).toContainText('3 × 12 · 40 кг');
      await expect(latest).toContainText('3 × 20 повт.');
      await expect(sessionGroup(page, '9 жовтня · Верх тіла')).toHaveCount(0);
      await setDays(page, 30);
      await expect(page).toHaveURL(/tab=workouts&days=30/);
      await expect(sessionGroup(page, '9 жовтня · Верх тіла')).toContainText('3 × 45 с');
      await expect(sessionGroup(page, '9 жовтня · Верх тіла')).toContainText(/40\sхв · ≈\s\d+\sккал/);
      await expect(sessionGroup(page, '7 жовтня · Ноги + прес')).toBeVisible();
      await expectNothingEditable(page, 'Тренування');
      await expectNoSideScroll(page, 'Тренування');

      // «Календар» on 12 Oct: the steps row and the session's exercises under the day.
      await clientTab(page, 'Календар');
      await page.getByRole('button', { name: /^12 жовтня/ }).click();
      const day = dayView(page);
      await expect(day).toHaveAccessibleName('12 жовтня 2026');
      await expect(day).toContainText('Кроки');
      await expect(day).toContainText('6 400');
      const session = sessionGroup(page, 'Ноги + прес');
      await expect(session).toContainText('Присідання зі штангою');
      await expect(session).toContainText('3 × 12 · 40 кг');
      await expect(session.getByRole('button')).toHaveCount(0);
      await expect(session.getByRole('link')).toHaveCount(0);
      await expect(page.getByRole('main').getByText(/додати/i)).toHaveCount(0);
      await expectNoSideScroll(page, 'day with a session');

      // «Прогрес»: her cards, never a link into her exercise pages.
      await clientTab(page, 'Прогрес');
      await expect(page.locator('main a[href^="/workouts"]')).toHaveCount(0);
      await expectNoSideScroll(page, 'Прогрес with workouts');

      expect(writes.coachWrites).toEqual([]);
      expect(writes.ops).toEqual([]);
    } finally {
      await disposeAll(all);
    }
  });

  test('the admin’s own id is not a client', async ({ page, admin }) => {
    await page.goto(`/coach/${admin.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Клієнта не знайдено' })).toBeVisible();
    await expect(page.getByText('Можливо, акаунт видалили або він став адміністратором.')).toBeVisible();
    await expect(backToClients(page)).toBeVisible();
  });

  test('a narrow desktop window (900, 1000): the table region scrolls, the page never does', async ({
    page,
    playwright,
    admin,
  }) => {
    test.skip(isPhone(page), 'desktop layout only');
    const c = await seedFour(playwright, admin);
    try {
      for (const width of [900, 1000]) {
        await page.setViewportSize({ width, height: 800 });
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
        await openClients(page, `?q=${c.tag}`);
        const region = clientsRegion(page);
        await expect(region.getByRole('link')).toHaveCount(4);
        const wider = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(wider, `the table is wider than its region at ${width}`).toBeGreaterThan(0);
        await expectNoSideScroll(page, `clients list ${width}`);
        await region.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        await expectNoSideScroll(page, `clients list ${width}, scrolled right`);
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await disposeAll(c.all);
    }
  });

  test('no side scroll on the phone at 390 and 320', async ({ page, playwright, admin }) => {
    test.skip(!isPhone(page), 'phone layout only');
    const c = await seedFour(playwright, admin);
    try {
      await stubCoachPhotos(page, FOOD_JPEG);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await openClients(page, `?q=${c.tag}`);
        await expect(clientsRegion(page).getByRole('link')).toHaveCount(4);
        await expectNoSideScroll(page, `list at ${width}`);
        await openClient(page, c.meals.creds.username);
        await expectNoSideScroll(page, `overview at ${width}`);
        for (const tab of ['Прогрес', 'Календар', 'Харчування', 'Тренування'] as const) {
          await clientTab(page, tab);
          await expectNoSideScroll(page, `${tab} at ${width}`);
        }
      }
    } finally {
      await disposeAll(c.all);
    }
  });
});
