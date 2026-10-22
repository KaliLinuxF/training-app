/**
 * Page helpers of the exercise library (docs/workouts-steps-rebrand.md §3.2–§3.4, the §3.6 picker), written against
 * roles and the copy: «Вправи» (list + groups + search), an exercise page (phone) / pane (desktop), the own-exercise
 * editor and the picker sheet.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type LibraryGroupChip =
  | 'Усі'
  | 'Груди'
  | 'Спина'
  | 'Плечі'
  | 'Руки'
  | 'Прес'
  | 'Ноги'
  | 'Сідниці'
  | 'Кардіо'
  | 'Мої';

export const LIBRARY_URL = '/workouts/library';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An exercise row is named «Назва Обладнання · мʼязи[ моя]»: match the name and a word boundary after it. */
const rowName = (name: string): RegExp => new RegExp(`^${escapeRegExp(name)}(\\s|$)`);

/** The desktop shell (≥ 900 px with a mouse) shows the exercise in a pane next to the list. */
export const isDesktopLayout = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 900;

/** Opens «Вправи» (`/workouts/library`, or an exercise under it) and waits for the list's <h1>. */
export async function openLibrary(page: Page, path: string = LIBRARY_URL): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Основна навігація' })).toBeVisible();
  if (path === LIBRARY_URL || isDesktopLayout(page))
    await expect(page.getByRole('heading', { level: 1, name: 'Вправи', exact: true })).toBeVisible();
}

/** The list of exercises on the library page. */
export function exerciseList(page: Page): Locator {
  return page.getByRole('region', { name: 'Список вправ', exact: true });
}

/** An exercise's link in the library list. */
export function exerciseLink(page: Page, name: string): Locator {
  return exerciseList(page).getByRole('link', { name: rowName(name) });
}

/** The visible names of the listed exercises, in order. */
export async function listedExercises(page: Page): Promise<string[]> {
  const names = await exerciseList(page).getByRole('link').evaluateAll((links) =>
    // The row's spans: thumb, title, sub (and the «моя» pill).
    links.map((a) => a.querySelector(':scope > span:nth-of-type(2)')?.textContent?.trim() ?? ''),
  );
  return names;
}

/** A group chip of the library or the picker («Усі», «Груди», …, «Мої»). */
export function groupChip(scope: Page | Locator, name: LibraryGroupChip): Locator {
  return scope.getByRole('group', { name: 'Групи вправ' }).getByRole('button', { name, exact: true });
}

/** Types into «Пошук вправи» (the library page, or inside a picker sheet when `scope` is one). */
export async function searchExercise(scope: Page | Locator, text: string): Promise<void> {
  await scope.getByRole('searchbox', { name: 'Пошук вправи' }).fill(text);
}

/**
 * The exercise's detail: the page's main content on the phone, the pane next to the list on the desktop (a region
 * named by its title).
 */
export function exerciseDetail(page: Page, name: string): Locator {
  return isDesktopLayout(page)
    ? page.getByRole('region', { name, exact: true })
    : page.getByRole('main');
}

/** Taps the exercise in the list and waits for its page (phone, <h1>) or pane (desktop, <h2>). */
export async function openExercise(page: Page, name: string): Promise<Locator> {
  await exerciseLink(page, name).click();
  const level = isDesktopLayout(page) ? 2 : 1;
  await expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible();
  return exerciseDetail(page, name);
}

/** «+ Своя вправа» → the «Нова вправа» sheet. */
export async function openNewExercise(scope: Page | Locator, page: Page): Promise<Locator> {
  await scope.getByRole('button', { name: '+ Своя вправа' }).click();
  const editor = page.getByRole('dialog', { name: 'Нова вправа', exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

/** Fills the editor: name, the muscles by their chips (one tap each = основний; `secondary` get two). */
export async function fillExercise(
  editor: Locator,
  { name, primary = [], secondary = [], kind }: { name: string; primary?: string[]; secondary?: string[]; kind?: string },
): Promise<void> {
  await editor.getByRole('textbox', { name: 'Назва' }).fill(name);
  if (kind) await editor.getByRole('radio', { name: kind, exact: true }).click();
  const muscles = editor.getByRole('group', { name: 'Мʼязи' });
  for (const m of primary) await muscles.getByRole('button', { name: m, exact: true }).click();
  for (const m of secondary) {
    await muscles.getByRole('button', { name: m, exact: true }).click();
    await muscles.getByRole('button', { name: `${m} · основний`, exact: true }).click();
  }
}

/**
 * In an open picker sheet: «Додати вправи» (many: taps each row, then «Додати (N)») or «Додати вправу» (one: the
 * tap picks and closes). Searches each name first, so rows far down the list need no scrolling.
 */
export async function pickExercises(page: Page, names: readonly string[]): Promise<void> {
  const multi = page.getByRole('dialog', { name: 'Додати вправи', exact: true });
  const single = page.getByRole('dialog', { name: 'Додати вправу', exact: true });
  const many = await multi.isVisible();
  const sheet = many ? multi : single;
  await expect(sheet).toBeVisible();
  const rows = sheet.getByRole('region', { name: 'Вправи', exact: true });
  for (const name of names) {
    await searchExercise(sheet, name);
    const row = rows.getByRole('button', { name: rowName(name) }).first();
    await row.click();
    if (many) await expect(row).toHaveAttribute('aria-pressed', 'true');
    else break;
  }
  if (many) {
    await sheet.getByRole('button', { name: `Додати (${names.length})`, exact: true }).click();
  }
  await expect(sheet).toBeHidden();
}
