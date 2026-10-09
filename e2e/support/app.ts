/** Page-level helpers: navigation, sheets, toasts — written against roles and visible copy. */
import { expect, type Locator, type Page } from '@playwright/test';

export type Section = 'Головна' | 'Календар' | 'Прогрес' | 'Нагадування';

/** <h1> of each section (Home greets by the hour: the fixed clock says 10:00 → «ранку»). */
const SECTION_TITLES: Record<Section, string | RegExp> = {
  Головна: /^Доброго (ранку|дня|вечора)$/,
  Календар: 'Календар',
  Прогрес: 'Мій прогрес',
  Нагадування: 'Нагадування',
};

export type SheetName =
  'Запис дня' | 'Контрольне зважування' | 'Заміри тіла' | 'Налаштування' | 'Встановлення на iPhone';

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

  heading(section: Section): Locator {
    return this.page.getByRole('heading', { level: 1, name: SECTION_TITLES[section] });
  }

  /** Taps a tab (mobile) / sidebar link (desktop) and waits for the screen title. */
  async go(section: Section): Promise<void> {
    await this.nav.getByRole('link', { name: section, exact: true }).click();
    await expect(this.heading(section)).toBeVisible();
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

  /** The «Збережено» pill (and other toasts): the live region whose whole text is `text`. */
  toast(text: string | RegExp): Locator {
    const exact =
      typeof text === 'string' ? new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : text;
    return this.page.locator('[role="status"][aria-atomic="true"]').filter({ hasText: exact });
  }

  region(name: string | RegExp): Locator {
    return this.page.getByRole('region', { name, exact: typeof name === 'string' });
  }

  /** Home quick buttons «Додати Харчування / Тренування / Вага / Заміри». */
  quickAction(label: 'Харчування' | 'Тренування' | 'Вага' | 'Заміри'): Locator {
    return this.page.getByRole('button', { name: `Додати ${label}`, exact: true });
  }

  /** Saves the open sheet («Зберегти» / «Почати») and waits for it to close. */
  async save(sheet: Locator, button: 'Зберегти' | 'Почати' = 'Зберегти'): Promise<void> {
    await sheet.getByRole('button', { name: button, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(this.toast('Збережено')).toBeVisible();
  }

  /** Values of `legko.data` / `legko.outbox` in IndexedDB (idb-keyval default store). */
  async deviceCache(): Promise<{ data: unknown; outbox: unknown }> {
    return this.page.evaluate(
      () =>
        new Promise<{ data: unknown; outbox: unknown }>((resolve, reject) => {
          const open = indexedDB.open('keyval-store');
          let missing = false;
          // No database yet: do not create one just by looking.
          open.onupgradeneeded = () => {
            missing = true;
            open.transaction?.abort();
          };
          open.onerror = () =>
            missing ? resolve({ data: undefined, outbox: undefined }) : reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('keyval')) {
              db.close();
              resolve({ data: undefined, outbox: undefined });
              return;
            }
            const store = db.transaction('keyval', 'readonly').objectStore('keyval');
            const data = store.get('legko.data');
            const outbox = store.get('legko.outbox');
            store.transaction.oncomplete = () => {
              db.close();
              resolve({ data: data.result as unknown, outbox: outbox.result as unknown });
            };
            store.transaction.onerror = () => reject(store.transaction.error);
          };
        }),
    );
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
