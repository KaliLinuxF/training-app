/**
 * Page helpers of «Клієнти» (docs/coach-cabinet.md §8.3), written against roles and the §7.2 copy: the list
 * (table on the desktop, list on the phone), its toolbar, a client page and its tabs, the read-only day.
 * `expectNoSideScroll` lives here too: spec files must not import other spec files (that registers their tests twice).
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type ClientTab = 'Огляд' | 'Прогрес' | 'Календар' | 'Харчування' | 'Тренування';
export type ShowFilter = 'Потребують уваги' | 'Усі';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A link named `name` exactly, or `name` followed by its row text (phone rows are named «name sub value»). */
const nameRe = (name: string): RegExp => new RegExp(`^${escapeRegExp(name)}(\\s|$)`);

/** The main navigation (sidebar on the desktop, tab bar on the phone). */
const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Основна навігація' });

/** Opens `/coach` (with an optional `?query`) and waits for the «Клієнти» title. */
export async function openClients(page: Page, query = ''): Promise<void> {
  await page.goto(`/coach${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Клієнти', exact: true })).toBeVisible();
}

/** The clients: the table's scrolling region (desktop, «Клієнти · за N днів») or the phone list («Клієнти»). */
export function clientsRegion(page: Page): Locator {
  return page.getByRole('region', { name: /^Клієнти( · за \d+ днів)?$/ });
}

/** A client's link in the list / table. */
export function clientLink(page: Page, name: string): Locator {
  return clientsRegion(page).getByRole('link', { name: nameRe(name) });
}

/** A client's table row (desktop) or list item (phone). */
export function clientRow(page: Page, name: string): Locator {
  return clientsRegion(page)
    .locator('tr, li')
    .filter({ has: page.getByRole('link', { name: nameRe(name) }) });
}

/** The table's column header whose label starts with `column` («Ккал», «Клієнт»…), desktop only. */
export function columnHeader(page: Page, column: string): Locator {
  return page.getByRole('columnheader', { name: new RegExp(`^${escapeRegExp(column)}`) });
}

/**
 * Sorts by `column`: a click on its header button (desktop: cycles first direction → opposite → default) or the
 * phone select's option with that label («Калорії», «Імʼя», «За увагою»…).
 */
export async function sortBy(page: Page, column: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Сортування' });
  if (await select.isVisible()) await select.selectOption({ label: column });
  else await columnHeader(page, column).getByRole('button').click();
}

/** Types into «Пошук за імʼям». */
export async function search(page: Page, q: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Пошук за імʼям' }).fill(q);
}

/** The «Показати» chip «Потребують уваги · N» / «Усі · N». */
export function filterChip(page: Page, which: ShowFilter): Locator {
  return page
    .getByRole('group', { name: 'Показати' })
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(which)} · \\d+$`) });
}

export async function showFilter(page: Page, which: ShowFilter): Promise<void> {
  await filterChip(page, which).click();
  await expect(filterChip(page, which)).toHaveAttribute('aria-pressed', 'true');
}

/** «7 днів» / «30 днів» (the list, «Огляд» and «Харчування»). */
export async function setDays(page: Page, days: 7 | 30): Promise<void> {
  const radio = page.getByRole('radiogroup', { name: 'Період' }).getByRole('radio', { name: `${days} днів` });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** Opens a client from the list and waits for their page (the name is the <h1>). */
export async function openClient(page: Page, name: string): Promise<void> {
  await clientLink(page, name).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** The tabs of a client page. */
export function clientTabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Розділи клієнта' });
}

/** Switches the client page to `tab` (replaces the URL) and waits until it is the current one. */
export async function clientTab(page: Page, tab: ClientTab): Promise<void> {
  const link = clientTabs(page).getByRole('link', { name: tab, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}

/** The read-only day of «Календар» (its card is named by the date «13 жовтня 2026»). */
export function dayView(page: Page): Locator {
  return page.getByRole('region', { name: /^\d{1,2} \S+ \d{4}$/ });
}

/**
 * A done session's group: «12 жовтня · Ноги + прес» in «Тренування», «Ноги + прес» under a day of «Календар»
 * (docs/workouts-steps-rebrand.md §3.18).
 */
export function sessionGroup(page: Page, title: string): Locator {
  return page.getByRole('region', { name: title, exact: true });
}

/** Whether the main navigation offers «Клієнти». */
export async function navHasClients(page: Page): Promise<boolean> {
  return (await mainNav(page).getByRole('link', { name: 'Клієнти', exact: true }).count()) > 0;
}

/** «‹ Клієнти» above a client page. */
export function backToClients(page: Page): Locator {
  return page.getByRole('link', { name: 'Назад: Клієнти' });
}

/** No horizontal scroll: neither the page nor an open sheet is wider than the screen. */
export async function expectNoSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => [
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].map(
      (d) => d.scrollWidth - d.clientWidth,
    ),
  ]);
  expect(Math.max(...overflow), `${what}: horizontal overflow`).toBeLessThanOrEqual(0);
}
