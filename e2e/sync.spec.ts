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
    // Reject the first batch that carries the day mark (any other op passes).
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

  // Chrome reports the legacy «Europe/Kiev» for Kyiv; the stored zone is «Europe/Kyiv».
  test('opening the app does not rewrite the settings when the device zone is an alias of the stored one', async ({
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

  test('a laptop in another time zone does not move the reminders', async ({ browser, server }) => {
    // Reminders follow the phone's zone (sent with its push subscription), not the last browser opened.
    const laptop = await browser.newContext({
      baseURL: 'http://127.0.0.1:3399',
      serviceWorkers: 'block',
      timezoneId: 'Europe/Simferopol',
      locale: 'uk-UA',
    });
    try {
      await laptop.clock.install({ time: new Date('2026-10-14T10:05:00+03:00') });
      await loginContext(laptop);
      const laptopPage = await laptop.newPage();
      const settingsWrites: unknown[] = [];
      laptopPage.on('request', (r) => {
        if (!r.url().endsWith('/api/ops')) return;
        const { ops } = r.postDataJSON() as { ops: { kind: string }[] };
        settingsWrites.push(...ops.filter((op) => op.kind === 'settings.put'));
      });
      const laptopApp = new App(laptopPage);
      await laptopApp.goto('/reminders');
      await expect(laptopApp.region('Дані')).toContainText('Усе синхронізовано');
      // A later foreground refresh does not write either.
      await laptopPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(laptopApp.region('Дані')).toContainText('Усе синхронізовано');
      expect(settingsWrites).toEqual([]);
    } finally {
      await laptop.close();
    }
    expect((await server.getData()).settings.timezone).toBe('Europe/Kyiv');
  });

  test('a tab that stays in front picks up changes from another device: on focus, then every minute', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    await expect(app.region('Сьогодні')).toContainText('Тренування · ще не відмічено');

    // The phone marks the day while this tab stays visible the whole time.
    const data = await server.getData();
    data.days[TODAY] = { food: '', kcal: null, types: [], notes: '', ...data.days[TODAY], trained: false };
    await server.importData(data);
    // The window gets focus back (a focus right after the start-up load is skipped).
    await page.clock.runFor(5_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(app.region('Сьогодні')).toContainText('Тренування · Не було');

    // The phone records a weigh-in; no event at all here, the minute poll brings it in.
    const next = await server.getData();
    next.weights.push({ date: TODAY, kg: 64.9 });
    await server.importData(next);
    await page.clock.runFor(60_000);
    await expect(app.region('Поточна вага')).toContainText('64,9');
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
