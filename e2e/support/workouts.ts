/**
 * Page helpers of the workouts pages (docs/workouts-steps-rebrand.md §3.5–§3.12), written against roles and the copy:
 * «Мої тренування», the builder, the session (live, summary, edit) and the past-day log. The full-screen pages have no
 * phone tab bar (W15), so they are waited for by their <h1>, not by `app.ready()`.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const WORKOUTS_URL = '/workouts';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An exact name in which any space may be a no-break space (the app puts one before units: «40 кг»). */
export const spaced = (text: string): RegExp => new RegExp(`^${escapeRegExp(text).replace(/ /g, '\\s')}$`);

/** The page's <h1>. */
export const pageTitle = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('heading', { level: 1, name, exact: typeof name === 'string' });

/** Opens «Мої тренування» and waits for its <h1>. */
export async function openWorkouts(page: Page): Promise<void> {
  await page.goto(WORKOUTS_URL);
  await expect(pageTitle(page, 'Мої тренування')).toBeVisible();
}

/** A workout's row (→ the builder) on «Мої тренування». */
export function workoutRow(page: Page, name: string): Locator {
  return page
    .getByRole('region', { name: 'Мої тренування', exact: true })
    .getByRole('link', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) });
}

/** «Почати» / «Продовжити» beside a workout (on «Мої тренування» and Home). */
export function startButton(
  page: Page | Locator,
  name: string,
  verb: 'Почати' | 'Продовжити' = 'Почати',
): Locator {
  return page.getByRole('button', { name: `${verb} тренування «${name}»`, exact: true });
}

/** The builder's exercise cards, in order. */
export function builderCards(page: Page): Locator {
  return page.locator('li[data-item]');
}

/** The exercise names of the builder's cards, in order. */
export async function builderNames(page: Page): Promise<string[]> {
  const names = await builderCards(page).locator('h3').allTextContents();
  return names.map((n) => n.replace(/^\d+\.\s*/, '').trim());
}

/** An exercise card of the session screen (live / edit). */
export function sessionCard(page: Page, name: string): Locator {
  return page
    .locator('li[data-entry]')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });
}

/** The ✓ of set `n` (1-based) of a card. */
export function setCheck(card: Locator, n: number): Locator {
  return card.getByRole('button', { name: `Підхід ${n} виконано`, exact: true });
}

/** The sticky footer button that confirms the current set («✓ Підхід 2 · 10 × 35 кг»). */
export function footerConfirm(page: Page): Locator {
  return page.getByRole('button', { name: /^✓ Підхід \d+ · / });
}

/** The rest bar (a group «Відпочинок») and its time. */
export function restBar(page: Page): Locator {
  return page.getByRole('group', { name: 'Відпочинок', exact: true });
}

/** The live elapsed timer in the session header. */
export function elapsedTimer(page: Page): Locator {
  return page.getByRole('timer', { name: /^Тривалість/ });
}

/** The app's own confirm dialog (alertdialog) with that title. */
export function confirmDialog(page: Page, title: string): Locator {
  return page.getByRole('alertdialog', { name: title, exact: true });
}

/** Answers the confirm dialog with its button `label`. */
export async function confirm(page: Page, title: string, label: string): Promise<void> {
  const dialog = confirmDialog(page, title);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** «⋯» of a card → an item of its menu. */
export async function cardAction(page: Page, card: Locator, cardName: string, item: string): Promise<void> {
  await card.getByRole('button', { name: `Дії: ${cardName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** The id at the end of a `/workouts/session/<id>` URL. */
export function sessionIdOf(page: Page): string {
  const match = /\/workouts\/session\/([^/?#]+)/.exec(page.url());
  if (!match?.[1]) throw new Error(`not a session page: ${page.url()}`);
  return decodeURIComponent(match[1]);
}
