/** Page-level helpers: navigation, sheets, toasts — written against roles and visible copy. */
import { expect, type Locator, type Page } from '@playwright/test';
import type { SessionUser } from '../../packages/shared/src/index';
import { USER, type Credentials } from './server';

/** The four sections of the tab bar / sidebar (redesign A). */
export type Section = 'Головна' | 'Календар' | 'Прогрес' | 'Налаштування';

/**
 * @deprecated `'Нагадування'` — shim, type-compatible only; behaviour changed (quickAction('Харчування') opens
 * «Їжа», go('Нагадування') lands on the list). The reminders moved to Settings: use `openSettings('Нагадування')`
 * for the sub-page; `heading('Нагадування')` is the phone sub-page's <h1>. Removed in the kit prune.
 */
export type LegacySection = Section | 'Нагадування';

/** <h1> of each section (Home greets by the hour: the fixed clock says 10:00 → «ранку»). */
const SECTION_TITLES: Record<LegacySection, string | RegExp> = {
  Головна: /^Доброго (ранку|дня|вечора)$/,
  Календар: 'Календар',
  Прогрес: 'Мій прогрес',
  Налаштування: 'Налаштування',
  Нагадування: 'Нагадування',
};

/**
 * Dialog names (the sheet heading). `'Налаштування'` is @deprecated — shim, type-compatible only; behaviour changed
 * (quickAction('Харчування') opens «Їжа», go('Нагадування') lands on the list). It was the old name of the first-run
 * sheet, now «Перші кроки», and no longer matches any sheet. Removed in the kit prune.
 */
export type SheetName =
  | 'Що записати?'
  | 'Їжа'
  | 'Прийом їжі'
  | 'Позиція'
  | 'Нова позиція'
  | 'Тренування'
  | 'Запис дня'
  | 'Контрольне зважування'
  | 'Заміри тіла'
  | 'Перші кроки'
  | 'Встановлення на iPhone'
  | 'Налаштування';

/** Rows of the «Що записати?» menu (opened by «+»), and «Повний запис дня →» under them. */
export type RecordItem = 'Їжа' | 'Тренування' | 'Вага' | 'Заміри' | 'Повний запис дня';

/** The sheet each «Що записати?» item swaps the menu to («Їжа» opens a new meal right away). */
const RECORD_SHEETS: Record<RecordItem, SheetName> = {
  Їжа: 'Прийом їжі',
  Тренування: 'Тренування',
  Вага: 'Контрольне зважування',
  Заміри: 'Заміри тіла',
  'Повний запис дня': 'Запис дня',
};

/** Action rows of the Home «Сьогодні» list. */
export type HomeRow = 'Їжа' | 'Тренування' | 'Вага' | 'Заміри';

/** Rows of the «Налаштування» list («Користувачі» is shown to admins only). */
export type SettingsSection =
  | 'Нагадування'
  | 'Цілі'
  | 'Типи тренувань'
  | 'Прийоми їжі'
  | 'Вигляд'
  | 'Дані і копія'
  | 'Акаунт'
  | 'Користувачі';

/** `/settings/:section` of each settings row. */
export const SETTINGS_SLUGS: Record<SettingsSection, string> = {
  Нагадування: 'reminders',
  Цілі: 'goals',
  'Типи тренувань': 'workouts',
  'Прийоми їжі': 'meals',
  Вигляд: 'appearance',
  'Дані і копія': 'data',
  Акаунт: 'account',
  Користувачі: 'users',
};

/** Label of the login / invite username field (with the Ukrainian apostrophe U+02BC). */
export const USERNAME_LABEL = 'Імʼя користувача';

/** The idb-keyval default store the app keeps its device copy in. */
const IDB_NAME = 'keyval-store';
const IDB_STORE = 'keyval';

/**
 * Every entry of the idb-keyval store (key → value; keys only when `withValues` is false), without creating the
 * database just by looking. Runs in the page.
 */
function readDeviceStore(page: Page, withValues: boolean): Promise<Record<string, unknown>> {
  return page.evaluate(
    ([name, storeName, values]) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open(name);
        let missing = false;
        // No database yet: do not create one just by looking.
        open.onupgradeneeded = () => {
          missing = true;
          open.transaction?.abort();
        };
        open.onerror = () => (missing ? resolve({}) : reject(open.error));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve({});
            return;
          }
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const keys = store.getAllKeys();
          const all = values ? store.getAll() : null;
          tx.oncomplete = () => {
            db.close();
            const out: Record<string, unknown> = {};
            keys.result.forEach((key, i) => {
              out[String(key)] = all ? (all.result[i] as unknown) : true;
            });
            resolve(out);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    [IDB_NAME, IDB_STORE, withValues] as const,
  );
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches an accessible name that starts with `text` (rows are named «Title sub value»). */
const startsWith = (text: string): RegExp => new RegExp(`^${escapeRegExp(text)}`);

export class App {
  constructor(readonly page: Page) {}

  /** Navigates and waits for the app shell (rendered only once auth and data are ready). */
  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
    await this.ready();
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.ready();
  }

  async ready(): Promise<void> {
    await expect(this.nav).toBeVisible();
  }

  get nav(): Locator {
    return this.page.getByRole('navigation', { name: 'Основна навігація' });
  }

  /**
   * The section's <h1>. `'Нагадування'` is a @deprecated shim — type-compatible only; behaviour changed
   * (quickAction('Харчування') opens «Їжа», go('Нагадування') lands on the list). It is the <h1> of the phone
   * sub-page `/settings/reminders`; on desktop that page's title is an <h2> under the <h1> «Налаштування».
   */
  heading(section: LegacySection): Locator {
    return this.page.getByRole('heading', { level: 1, name: SECTION_TITLES[section] });
  }

  /**
   * Taps a tab (mobile) / sidebar link (desktop) and waits for the screen title.
   * `'Нагадування'` is a @deprecated shim — type-compatible only; behaviour changed (quickAction('Харчування')
   * opens «Їжа», go('Нагадування') lands on the list): it taps «Налаштування» and waits for the list's <h1>.
   * Use `openSettings('Нагадування')` to reach the reminders.
   */
  async go(section: LegacySection): Promise<void> {
    const target: Section = section === 'Нагадування' ? 'Налаштування' : section;
    await this.nav.getByRole('link', { name: target, exact: true }).click();
    await expect(this.heading(target)).toBeVisible();
  }

  /** «+» in the tab bar / «+ Записати день» in the sidebar. */
  recordButton(): Locator {
    return this.page.getByRole('button', { name: /Записати день$/ });
  }

  sheet(name: SheetName): Locator {
    return this.page.getByRole('dialog', { name, exact: true });
  }

  /** Any open sheet / dialog. */
  get dialogs(): Locator {
    return this.page.getByRole('dialog');
  }

  async expectSheetClosed(): Promise<void> {
    await expect(this.dialogs).toHaveCount(0);
  }

  /**
   * «+» (tab bar) / «+ Записати день» (sidebar) → `item` in the «Що записати?» menu. Returns the sheet the menu
   * swapped to (Прийом їжі — a new meal —, Тренування, Контрольне зважування, Заміри тіла, or Запис дня), once
   * it is visible.
   */
  async record(item: RecordItem): Promise<Locator> {
    await this.recordButton().click();
    await this.sheet('Що записати?')
      .getByRole('button', { name: startsWith(item) })
      .click();
    const target = this.sheet(RECORD_SHEETS[item]);
    await expect(target).toBeVisible();
    return target;
  }

  /** The «Збережено» pill (and other toasts): the live region whose whole text is `text`. */
  toast(text: string | RegExp): Locator {
    const exact = typeof text === 'string' ? new RegExp(`^${escapeRegExp(text)}$`) : text;
    return this.page.locator('[role="status"][aria-atomic="true"]').filter({ hasText: exact });
  }

  region(name: string | RegExp): Locator {
    return this.page.getByRole('region', { name, exact: typeof name === 'string' });
  }

  /** A Home «Сьогодні» row (opens its short sheet); the name starts with the row title. */
  homeRow(name: HomeRow): Locator {
    return this.region('Сьогодні').getByRole('button', { name: startsWith(name) });
  }

  /** The inline ✓ («Було») / ✕ («Не було») of the Home «Тренування» row (saves at once, no sheet). */
  trainingToggle(name: 'Було' | 'Не було'): Locator {
    return this.region('Сьогодні').getByRole('button', { name, exact: true });
  }

  /** The Home week row «Тиждень · 2 з 3 трен. …» → `/progress?period=week`. */
  weekLink(): Locator {
    return this.page.getByRole('link', { name: /^Тиждень/ });
  }

  /** A row of the «Налаштування» list (phone list / desktop sidebar of the split view). */
  settingsRow(title: SettingsSection): Locator {
    return this.page
      .getByRole('navigation', { name: 'Розділи налаштувань' })
      .getByRole('link', { name: startsWith(title) });
  }

  /** Tab «Налаштування» → the section's row → waits for the section heading (<h1> phone, <h2> desktop). */
  async openSettings(title: SettingsSection): Promise<void> {
    await this.go('Налаштування');
    await this.settingsRow(title).click();
    await expect(this.page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  }

  /** Opens `/settings/<slug>` directly (deep link: the back link replace-navigates to the list). */
  async gotoSettings(title: SettingsSection): Promise<void> {
    await this.goto(`/settings/${SETTINGS_SLUGS[title]}`);
  }

  /**
   * «‹ Налаштування» above a settings sub-page title. Phone only — the desktop split view has no back link,
   * so gate tests that use it to the `iphone` project.
   */
  settingsBack(): Locator {
    return this.page.getByRole('link', { name: 'Назад: Налаштування' });
  }

  /**
   * @deprecated shim — type-compatible only; behaviour changed (quickAction('Харчування') opens «Їжа»,
   * go('Нагадування') lands on the list). The Home quick buttons are gone: this is
   * `homeRow(label === 'Харчування' ? 'Їжа' : label)`. Removed in the kit prune.
   */
  quickAction(label: 'Харчування' | 'Їжа' | 'Тренування' | 'Вага' | 'Заміри'): Locator {
    return this.homeRow(label === 'Харчування' ? 'Їжа' : label);
  }

  /**
   * The list of meals in `sheet`: the region «Прийоми їжі». The same name is used by the «Їжа» day list and by
   * the food field of «Запис дня», so these helpers work in both.
   */
  mealList(sheet: Locator): Locator {
    return sheet.getByRole('region', { name: 'Прийоми їжі', exact: true });
  }

  /** A meal row of `mealList(sheet)`: the button whose accessible name starts with `title` («Сніданок о 08:30: …»). */
  mealRow(sheet: Locator, title: string): Locator {
    return this.mealList(sheet).getByRole('button', { name: startsWith(title) });
  }

  /** «+ Прийом їжі» in `sheet` (accessible name «Додати прийом їжі»). */
  addMealButton(sheet: Locator): Locator {
    return sheet.getByRole('button', { name: 'Додати прийом їжі', exact: true });
  }

  /** A type chip of the meal editor in `sheet` (group «Тип прийому їжі»; selected = `aria-pressed="true"`). */
  mealType(sheet: Locator, label: string): Locator {
    return sheet
      .getByRole('group', { name: 'Тип прийому їжі' })
      .getByRole('button', { name: label, exact: true });
  }

  /**
   * Home «Їжа» row → the day's meal list «Їжа», once visible. Needs food logged today: on a day without food the
   * row opens the new-meal editor «Прийом їжі» instead (use `newMeal()` or `sheet('Прийом їжі')` then).
   */
  async openFoodDay(): Promise<Locator> {
    await this.homeRow('Їжа').click();
    const sheet = this.sheet('Їжа');
    await expect(sheet).toBeVisible();
    return sheet;
  }

  /** «+» → «Їжа»: the new-meal editor «Прийом їжі» for today (type preselected, «Що я їла» focused). */
  newMeal(): Promise<Locator> {
    return this.record('Їжа');
  }

  /** «Зберегти» of the meal editor `sheet` (a stacked one too): waits for it to close and for «Збережено». */
  async saveMeal(sheet: Locator): Promise<void> {
    await sheet.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(this.toast('Збережено')).toBeVisible();
  }

  /** Saves the open sheet («Зберегти» / «Почати») and waits for it to close. */
  async save(sheet: Locator, button: 'Зберегти' | 'Почати' = 'Зберегти'): Promise<void> {
    await sheet.getByRole('button', { name: button, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(this.toast('Збережено')).toBeVisible();
  }

  /**
   * The device user's copy in IndexedDB (idb-keyval default store): `legko.user` (the full SessionUser whose copy
   * this device holds), then that user's `legko.data.<id>` / `legko.outbox.<id>`; each undefined when absent (no
   * pointer → no data / outbox). The legacy keys `legko.data` / `legko.outbox` are read with `deviceEntries()`.
   */
  async deviceCache(): Promise<{ user: SessionUser | undefined; data: unknown; outbox: unknown }> {
    const entries = await this.deviceEntries();
    const user = entries['legko.user'] as SessionUser | undefined;
    const id = typeof user === 'object' && user !== null && typeof user.id === 'string' ? user.id : undefined;
    return {
      user,
      data: id === undefined ? undefined : entries[`legko.data.${id}`],
      outbox: id === undefined ? undefined : entries[`legko.outbox.${id}`],
    };
  }

  /** Every key of the idb-keyval store, sorted (`[]` when there is no database; never creates it). */
  async deviceKeys(): Promise<string[]> {
    return Object.keys(await readDeviceStore(this.page, false)).sort();
  }

  /** Every key → value of the idb-keyval store (`{}` when there is no database; never creates it). */
  deviceEntries(): Promise<Record<string, unknown>> {
    return readDeviceStore(this.page, true);
  }

  /** «Увійти» of the login form. */
  loginButton(): Locator {
    return this.page.getByRole('button', { name: 'Увійти', exact: true });
  }

  /**
   * On the login screen: fills «Імʼя користувача» and «Пароль», then clicks «Увійти» (does not wait for the result:
   * the app, an error, or the switch confirm).
   */
  async loginUi(creds: Credentials = USER): Promise<void> {
    await this.page.getByLabel(USERNAME_LABEL, { exact: true }).fill(creds.username);
    await this.page.getByLabel('Пароль', { exact: true }).fill(creds.password);
    await this.loginButton().click();
  }

  /**
   * Settings → «Акаунт» → «Вийти» → confirm «Вийти» (a synced device: the unsynced warning has another button), then
   * waits for the login screen. «Вийти» is no longer on the settings list (D30).
   */
  async logoutUi(): Promise<void> {
    await this.openSettings('Акаунт');
    await this.page.getByRole('button', { name: 'Вийти', exact: true }).click();
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Вийти', exact: true }).click();
    // The app shows the login screen for a moment, then reloads to `/`: wait for that page, not the first one.
    await this.page.waitForURL((url) => url.pathname === '/');
    await expect(this.loginButton()).toBeVisible();
  }

  /** The «Користувачі» user sheet (a dialog named by the username). */
  userSheet(username: string): Locator {
    return this.page.getByRole('dialog', { name: username, exact: true });
  }
}

/** Accepts the next `window.confirm()` (Playwright dismisses dialogs by default). */
export function acceptNextDialog(page: Page, expectedMessage?: string | RegExp): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', (dialog) => {
      const message = dialog.message();
      if (expectedMessage !== undefined) {
        const okMessage =
          typeof expectedMessage === 'string' ? message === expectedMessage : expectedMessage.test(message);
        if (!okMessage) {
          void dialog.dismiss().then(() => resolve(message));
          return;
        }
      }
      void dialog.accept().then(() => resolve(message));
    });
  });
}
