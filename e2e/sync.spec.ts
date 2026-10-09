import { TODAY } from './support/env';
import { App } from './support/app';
import { loginContext } from './support/server';
import { expect, test } from './support/test';

/** Two devices on the same account: changes travel through the server. */
test.describe('sync between devices', () => {
  test('a change on the phone shows up on the laptop when it comes back to the foreground', async ({
    app,
    page,
    browser,
    server,
  }) => {
    await app.goto('/');
    await expect(app.region('Сьогодні')).toContainText('Тренування · ще не відмічено');

    // Second device.
    const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3399', serviceWorkers: 'block' });
    try {
      await other.clock.install({ time: new Date('2026-10-14T10:05:00+03:00') });
      await loginContext(other);
      const otherPage = await other.newPage();
      const otherApp = new App(otherPage);
      await otherApp.goto('/');
      await otherApp.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
      await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(false);
    } finally {
      await other.close();
    }

    // Nothing pending here: returning to the app re-reads the server.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(app.region('Сьогодні')).toContainText('Тренування · Не було');
  });

  test('a server hiccup (500) is retried with backoff until the change lands', async ({
    app,
    page,
    server,
  }) => {
    let failures = 0;
    await page.route('**/api/ops', async (route) => {
      if (failures < 2) {
        failures++;
        await route.fulfill({ status: 500, json: { error: 'internal', message: 'boom' } });
      } else {
        await route.continue();
      }
    });
    await app.goto('/');
    await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
    // Backoff 2 s, then 4 s.
    await expect
      .poll(async () => (await server.getData()).days[TODAY]?.trained, { timeout: 15_000 })
      .toBe(false);
    expect(failures).toBe(2);
  });

  test('an op the server rejects is dropped, announced, and the screen re-reads the server', async ({
    app,
    page,
    server,
  }) => {
    // Reject the first batch that carries the day mark (other ops, e.g. a time-zone fix at start-up, pass).
    let rejected = false;
    await page.route('**/api/ops', async (route) => {
      const { ops } = route.request().postDataJSON() as { ops: { kind: string }[] };
      const index = ops.findIndex((op) => op.kind === 'day.put');
      if (rejected || index < 0) return route.continue();
      rejected = true;
      return route.fulfill({
        status: 400,
        json: { error: 'invalid_op', index, message: `Операція №${index}: bad` },
      });
    });
    await app.goto('/');
    await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
    await expect(app.toast('Сервер відхилив одну зміну — її не збережено')).toBeVisible();
    await expect(app.region('Сьогодні')).toContainText('Тренування · ще не відмічено');
    expect((await server.getData()).days[TODAY]?.trained).toBeNull();
  });

  // FIXME(app bug, see the e2e report «Time-zone alias makes every Chromium start rewrite the settings»):
  // Chrome resolves Europe/Kyiv to the legacy «Europe/Kiev», `fixTimezone` compares the raw strings
  // and re-uploads the whole settings object (timezone «Europe/Kiev») at every session start.
  test.fixme('opening the app does not rewrite the settings when the device zone is an alias of the stored one', async ({
    app,
    page,
    server,
  }) => {
    const settingsWrites: unknown[] = [];
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/ops')) return;
      const { ops } = r.postDataJSON() as { ops: { kind: string }[] };
      settingsWrites.push(...ops.filter((op) => op.kind === 'settings.put'));
    });
    await app.goto('/reminders');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    expect(settingsWrites).toEqual([]);
    expect((await server.getData()).settings.timezone).toBe('Europe/Kyiv');
  });

  test('pending local changes are not overwritten by an older server copy', async ({
    app,
    page,
    context,
    server,
  }) => {
    await app.goto('/');
    await context.setOffline(true);
    await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();

    // Meanwhile another device changes something else on the server.
    const data = await server.getData();
    data.settings.goal = 58;
    await server.importData(data);

    await context.setOffline(false);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(false);
    await expect(app.region('Сьогодні')).toContainText('Тренування · Не було');
    // The other device's change arrived too.
    await app.reload();
    await expect(app.region('Поточна вага')).toContainText('Ціль 58,0');
  });
});
