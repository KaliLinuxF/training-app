import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { AppData } from '../packages/shared/src/index';
import { onboarded } from './fixtures/data';
import { TODAY } from './support/env';
import { expect, test } from './support/test';

const backupInput = (page: Page) => page.locator('input[type="file"][accept="application/json,.json"]');

/**
 * Records (and dismisses) native browser dialogs. Every question must be the app's own
 * alertdialog: `window.confirm` looks foreign in the installed iPhone app.
 */
function watchNativeDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** A small, valid backup that differs from the demo data everywhere. */
function backup(): AppData {
  const data = onboarded();
  data.settings.goal = 70;
  data.days = {
    '2026-10-01': {
      food: 'Імпортований день',
      kcal: 2000,
      trained: true,
      types: ['Розтяжка'],
      notes: 'з файлу',
    },
    '2026-10-02': { food: 'Ще один', kcal: 1900, trained: false, types: [], notes: '' },
  };
  data.weights = [{ date: '2026-10-01', kg: 80 }];
  return data;
}

const file = (data: unknown, name = 'legko-backup.json') => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

interface SharedFile {
  name: string;
  type: string;
  text: string;
}

test.describe('backup', () => {
  test('«Завантажити резервну копію» downloads the full data, including a change made just before', async ({
    app,
    page,
  }) => {
    await app.gotoSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    // In-app navigation from here on (no reload): the change may still be on its way to the server.
    await app.openSettings('Цілі');
    await app.region('Мої цілі').getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await app.openSettings('Дані і копія');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Завантажити резервну копію' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^legko-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile(await file.path(), 'utf8')) as AppData;

    expect(Object.keys(data.days)).toHaveLength(65);
    expect(data.days[TODAY]?.food).toBe('Вівсянка з бананом, кава');
    expect(data.weights).toHaveLength(11);
    expect(data.measures.at(-1)).toEqual({ date: '2026-10-12', chest: 90, waist: 70, hips: 98 });
    expect(data.foods.map((f) => f.name)).toContain('Кава з молоком');
    expect(data.settings).toMatchObject({ goal: 60.5, kcalGoal: 1700, onboarded: true });
  });

  test('the installed iPhone app saves the copy through the share sheet, never a download that traps it', async ({
    app,
    page,
    server,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'the iPhone home-screen app only');
    // Home-screen app with Web Share (iOS 15+); the share sheet is replaced by a recorder.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      const shared: { name: string; type: string; text: string }[] = [];
      Object.assign(window, { __shared: shared });
      navigator.canShare = (data?: ShareData) => Boolean(data?.files?.length);
      navigator.share = async (data?: ShareData) => {
        for (const f of data?.files ?? []) shared.push({ name: f.name, type: f.type, text: await f.text() });
      };
    });
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });
    const sharedFiles = () => page.evaluate(() => (window as unknown as { __shared: SharedFile[] }).__shared);

    await app.gotoSettings('Дані і копія');
    const dataCard = app.region('Дані');
    await expect(dataCard).toContainText('Усе синхронізовано');
    await expect(dataCard.getByRole('link')).toHaveCount(0);

    // A change made just before is in the copy (in-app navigation, no reload in between).
    await app.openSettings('Цілі');
    await app.region('Мої цілі').getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await app.openSettings('Дані і копія');
    await dataCard.getByRole('button', { name: 'Завантажити резервну копію' }).click();
    await expect.poll(async () => (await sharedFiles()).length).toBe(1);

    const [shared] = await sharedFiles();
    expect(shared?.name).toBe(`legko-${TODAY}.json`);
    expect(shared?.type).toBe('application/json');
    const data = JSON.parse(shared?.text ?? '') as AppData;
    expect(Object.keys(data.days)).toHaveLength(65);
    expect(data.days[TODAY]?.food).toBe('Вівсянка з бананом, кава');
    expect(data.weights).toHaveLength(11);
    expect(data.settings).toMatchObject({ goal: 60.5, kcalGoal: 1700, onboarded: true });
    // The same copy the server would have given.
    await expect.poll(async () => (await server.getData()).settings.goal).toBe(60.5);
    expect(data).toEqual(await server.getData());

    expect(downloads).toBe(0);
    await expect(app.nav).toBeVisible();
  });

  test('«Відновити з копії» asks in the app, then replaces everything on the server and on screen', async ({
    app,
    page,
    server,
  }) => {
    await app.gotoSettings('Дані і копія');
    const native = watchNativeDialogs(page);
    const ask = page.getByRole('alertdialog', { name: 'Відновити з резервної копії?' });

    // Declining the confirmation changes nothing.
    await backupInput(page).setInputFiles(file(backup()));
    await expect(ask).toContainText('Усі поточні записи буде замінено даними з файлу.');
    // A destructive question starts on the safe answer.
    await expect(ask.getByRole('button', { name: 'Скасувати' })).toBeFocused();
    await ask.getByRole('button', { name: 'Скасувати' }).click();
    await expect(ask).toBeHidden();
    await expect(page.getByRole('button', { name: 'Відновити з копії' })).toBeEnabled();
    expect(Object.keys((await server.getData()).days)).toHaveLength(65);
    await expect(app.toast('Дані відновлено')).toHaveCount(0);

    await backupInput(page).setInputFiles(file(backup()));
    await ask.getByRole('button', { name: 'Відновити', exact: true }).click();
    await expect(app.toast('Дані відновлено')).toBeVisible();
    await expect(ask).toBeHidden();

    const stored = await server.getData();
    expect(stored.days).toEqual(backup().days);
    expect(stored.weights).toEqual([{ date: '2026-10-01', kg: 80 }]);
    expect(stored.measures).toEqual([]);
    expect(stored.foods).toEqual([]);
    expect(stored.settings.goal).toBe(70);

    // The list sums up the restored goal at once.
    await app.go('Налаштування');
    await expect(app.settingsRow('Цілі')).toContainText('70 кг');

    await app.go('Головна');
    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('80,0');
    await expect(hero).toContainText('до цілі 10,0 кг');
    // Nothing recorded today in the backup.
    await expect(app.homeRow('Їжа')).toContainText('—');
    await app.go('Прогрес');
    await expect(app.region('Вага')).toContainText('Ціль 70,0');

    await app.goto('/calendar?date=2026-10-01');
    const day = app.region('1 жовтня 2026');
    await expect(day).toContainText('Імпортований день');
    await expect(day).toContainText('Розтяжка');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(native).toEqual([]);
  });

  test('a file that is not a backup is refused without asking or touching the data', async ({
    app,
    page,
    server,
  }) => {
    await app.gotoSettings('Дані і копія');
    const native = watchNativeDialogs(page);
    await backupInput(page).setInputFiles(file('{"days": "nope"}', 'random.json'));
    await expect(app.toast('Файл не схожий на резервну копію «Легко»')).toBeVisible();
    await backupInput(page).setInputFiles(file('not json at all', 'notes.json'));
    await expect(app.toast('Файл не схожий на резервну копію «Легко»')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(native).toEqual([]);
    expect(Object.keys((await server.getData()).days)).toHaveLength(65);
  });
});

test.describe('account', () => {
  /** The «Вийти» row of the settings list (only touched while no dialog is open: the dialog has its own «Вийти»). */
  const logoutButton = (page: Page) => page.getByRole('button', { name: 'Вийти', exact: true });

  test('«Вийти» asks, then returns to the login screen and wipes this device', async ({ app, page }) => {
    await app.goto('/settings');
    const native = watchNativeDialogs(page);
    expect((await app.deviceCache()).data).toBeTruthy();
    const ask = page.getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' });

    await logoutButton(page).click();
    await expect(ask).toContainText('Усі записи залишаться на сервері.');
    await ask.getByRole('button', { name: 'Скасувати' }).click();
    await expect(ask).toBeHidden();
    await expect(logoutButton(page)).toBeEnabled();
    await expect(app.nav).toBeVisible();

    await logoutButton(page).click();
    await ask.getByRole('button', { name: 'Вийти', exact: true }).click();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect(app.nav).toBeHidden();
    await expect.poll(async () => (await app.deviceCache()).data).toBeUndefined();
    expect((await app.deviceCache()).outbox).toBeUndefined();

    // The session is gone on the server too.
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(401);
    await page.reload();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    expect(native).toEqual([]);
  });

  test('with unsynced changes offline, «Вийти» warns that they will be lost', async ({
    app,
    page,
    context,
  }) => {
    await app.goto('/');
    await context.setOffline(true);
    await app.trainingToggle('Не було').click();
    await app.go('Налаштування');
    await expect(app.settingsRow('Дані і копія')).toContainText('Офлайн · 1 зміна');
    // Offline, so in-app navigation only (a page load would fail).
    await app.settingsRow('Дані і копія').click();
    await expect(app.region('Дані')).toContainText('Офлайн — 1 зміна чекає на інтернет');
    await app.go('Налаштування');
    const native = watchNativeDialogs(page);
    const ask = page.getByRole('alertdialog', { name: 'Деякі зміни ще не синхронізовано' });

    await logoutButton(page).click();
    await expect(ask).toContainText('Якщо вийти зараз, вони будуть втрачені.');
    // Escape answers «no».
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(logoutButton(page)).toBeEnabled();
    await expect(app.nav).toBeVisible();

    await logoutButton(page).click();
    await ask.getByRole('button', { name: 'Усе одно вийти' }).click();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect.poll(async () => (await app.deviceCache()).outbox).toBeUndefined();
    expect(native).toEqual([]);
  });
});
