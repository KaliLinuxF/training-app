import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { AppData } from '../packages/shared/src/index';
import { onboarded } from './fixtures/data';
import { acceptNextDialog } from './support/app';
import { TODAY } from './support/env';
import { expect, test } from './support/test';

const backupInput = (page: Page) => page.locator('input[type="file"][accept="application/json,.json"]');

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

test.describe('backup', () => {
  test('«Завантажити резервну копію» downloads the full data, including a change made just before', async ({
    app,
    page,
  }) => {
    await app.goto('/reminders');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await app.region('Мої цілі').getByRole('button', { name: 'Збільшити цільову вагу' }).click();

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

  test('«Відновити з копії» asks, then replaces everything on the server and on screen', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/reminders');

    // Declining the confirmation changes nothing.
    const declined = new Promise<string>((resolve) =>
      page.once('dialog', (d) => {
        resolve(d.message());
        void d.dismiss();
      }),
    );
    await backupInput(page).setInputFiles(file(backup()));
    expect(await declined).toBe('Це замінить усі записи даними з файлу. Продовжити?');
    await expect(page.getByRole('button', { name: 'Відновити з копії' })).toBeEnabled();
    expect(Object.keys((await server.getData()).days)).toHaveLength(65);
    await expect(app.toast('Дані відновлено')).toHaveCount(0);

    const asked = acceptNextDialog(page);
    await backupInput(page).setInputFiles(file(backup()));
    expect(await asked).toBe('Це замінить усі записи даними з файлу. Продовжити?');
    await expect(app.toast('Дані відновлено')).toBeVisible();

    const stored = await server.getData();
    expect(stored.days).toEqual(backup().days);
    expect(stored.weights).toEqual([{ date: '2026-10-01', kg: 80 }]);
    expect(stored.measures).toEqual([]);
    expect(stored.foods).toEqual([]);
    expect(stored.settings.goal).toBe(70);

    await app.go('Головна');
    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('80,0');
    await expect(hero).toContainText('Ціль 70,0');
    await expect(app.region('Сьогодні')).toContainText('Не записано');

    await app.goto('/calendar?date=2026-10-01');
    await expect(app.region('1 жовтня 2026')).toContainText('✓ Розтяжка');
  });

  test('a file that is not a backup is refused without touching the data', async ({ app, page, server }) => {
    await app.goto('/reminders');
    let confirmed = false;
    page.on('dialog', (d) => {
      confirmed = true;
      void d.dismiss();
    });
    await backupInput(page).setInputFiles(file('{"days": "nope"}', 'random.json'));
    await expect(app.toast('Файл не схожий на резервну копію «Легко»')).toBeVisible();
    await backupInput(page).setInputFiles(file('not json at all', 'notes.json'));
    await expect(app.toast('Файл не схожий на резервну копію «Легко»')).toBeVisible();
    expect(confirmed).toBe(false);
    expect(Object.keys((await server.getData()).days)).toHaveLength(65);
  });
});

test.describe('account', () => {
  test('«Вийти» returns to the login screen and wipes this device', async ({ app, page }) => {
    await app.goto('/reminders');
    expect((await app.deviceCache()).data).toBeTruthy();

    await page.getByRole('button', { name: 'Вийти' }).click();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect(app.nav).toBeHidden();
    await expect.poll(async () => (await app.deviceCache()).data).toBeUndefined();
    expect((await app.deviceCache()).outbox).toBeUndefined();

    // The session is gone on the server too.
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(401);
    await page.reload();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  });

  test('with unsynced changes offline, «Вийти» asks first', async ({ app, page, context }) => {
    await app.goto('/');
    await context.setOffline(true);
    await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
    await app.go('Нагадування');
    await expect(app.region('Дані')).toContainText('Офлайн — 1 зміна чекає на інтернет');

    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Вийти' }).click();
    await expect(page.getByRole('button', { name: 'Вийти' })).toBeEnabled();
    await expect(app.nav).toBeVisible();

    const asked = acceptNextDialog(page);
    await page.getByRole('button', { name: 'Вийти' }).click();
    expect(await asked).toBe(
      'Деякі зміни ще не встигли синхронізуватися з сервером і будуть втрачені. Все одно вийти?',
    );
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect.poll(async () => (await app.deviceCache()).outbox).toBeUndefined();
  });
});
