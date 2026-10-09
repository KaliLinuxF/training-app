import { todayISO } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { authActions } from '@/auth/auth';
import type * as ApiModule from '@/lib/api';
import { ApiError } from '@/lib/api';
import { DESKTOP_QUERY } from '@/lib/platform';
import type { PushStatus } from '@/lib/push';
import { dataActions, useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { deferred, sampleData, settle } from '@/store/test-utils';
import type * as SyncModule from '@/store/sync';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from '@/ui';
import { installMatchMedia } from '@/ui/internal/testing';
import { backupDevice, type ShareHost } from './backupFile';
import { parseBackup } from './model';
import listStyles from './SettingsList.module.css';
import { SettingsScreen } from './SettingsScreen';

const mocks = vi.hoisted(() => ({
  push: {
    getPushStatus: vi.fn<() => Promise<PushStatus>>(),
    enablePush: vi.fn<() => Promise<PushStatus>>(),
    disablePush: vi.fn<() => Promise<void>>(),
    sendTestPush: vi.fn<() => Promise<number>>(),
    syncPushSubscription: vi.fn<() => Promise<void>>(),
  },
  api: { sendOps: vi.fn(), getData: vi.fn(), importData: vi.fn(), logout: vi.fn() },
  flushNow: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@/lib/push', () => mocks.push);
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { ...mocks.api, exportUrl: '/api/export' },
}));
vi.mock('@/store/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof SyncModule>()),
  flushNow: mocks.flushNow,
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const settings = () => useDataStore.getState().data.settings;
const toast = () => useUiStore.getState().toast?.text;
const patchSync = (patch: Partial<ReturnType<typeof initialSyncState>>) =>
  act(() => useDataStore.setState((st) => ({ sync: { ...st.sync, ...patch } })));
/** Text with every kind of space (f0's no-break spaces, line breaks) as one plain space. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The settings route of App.tsx inside an in-memory router; `memory.history` records the navigations. */
function renderAt(path: string, status: PushStatus = 'default') {
  mocks.push.getPushStatus.mockResolvedValue(status);
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={memory.hook}>
      <Switch>
        <Route path="/settings/:section?" component={SettingsScreen} />
      </Switch>
    </Router>,
  );
  return { ...view, memory };
}

/** Renders and waits for the push status check to land. */
async function renderReady(path: string, status: PushStatus = 'default') {
  const view = renderAt(path, status);
  await act(settle);
  return view;
}

const region = (name: string) => within(screen.getByRole('region', { name }));
const nav = () => within(screen.getByRole('navigation', { name: 'Розділи налаштувань' }));
/** A row of the list: its link's name starts with the section title. */
const row = (title: string) => nav().getByRole('link', { name: new RegExp(`^${title}`) });
const desktop = () => installMatchMedia((query) => query === DESKTOP_QUERY);

beforeEach(() => {
  installMatchMedia();
  for (const fn of Object.values(mocks.push)) fn.mockReset();
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.sendOps.mockReturnValue(new Promise(() => undefined));
  mocks.flushNow.mockReset().mockResolvedValue(true);
  useDataStore.setState({ data: sampleData(), sync: { ...initialSyncState(), loaded: true, online: true } });
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.history.replaceState(null, '');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

describe('SettingsScreen — the list (phone)', () => {
  it('shows the header, the five sections with their summaries, «Вийти» and the caption', async () => {
    await renderReady('/settings', 'enabled');
    const h1 = screen.getByRole('heading', { level: 1, name: 'Налаштування' });
    const navEl = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    // Classic layout: the groups follow the header directly (no spacer, no docking wrapper).
    expect(h1.closest('header')?.nextElementSibling).toBe(navEl);

    const links = within(navEl).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/settings/reminders',
      '/settings/goals',
      '/settings/workouts',
      '/settings/appearance',
      '/settings/data',
    ]);
    expect(links.map((a) => plain(a.textContent))).toEqual([
      'Нагадування 3 увімк.',
      'Цілі 60 кг · 1 700 ккал',
      'Типи тренувань 7 типів',
      'Вигляд Авто',
      'Дані і копія Синхронізовано',
    ]);
    // Two groups: what she plans with, then the app.
    expect(
      within(navEl)
        .getAllByRole('list')
        .map((ul) => within(ul).getAllByRole('link').length),
    ).toEqual([3, 2]);
    for (const link of links) expect(link.getAttribute('aria-current')).toBeNull();

    const logout = screen.getByRole('button', { name: 'Вийти' });
    expect(navEl.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Легко · трекер схуднення')).toBeTruthy();
    // No section content on the list itself.
    expect(screen.queryByRole('region', { name: 'Сповіщення на телефон' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Назад: Налаштування' })).toBeNull();
  });

  it('puts a push problem badge inside the «Нагадування» link (part of its name)', async () => {
    const cases: [PushStatus, string | null][] = [
      ['default', 'Сповіщення вимкнені'],
      ['denied', 'Сповіщення заборонені'],
      ['needs-install', 'Потрібне встановлення'],
      ['unsupported', 'Сповіщення недоступні'],
      ['enabled', null],
    ];
    for (const [status, badge] of cases) {
      await renderReady('/settings', status);
      const name = plain(row('Нагадування').textContent);
      expect(name, status).toBe(badge ? `Нагадування ${badge} 3 увімк.` : 'Нагадування 3 увімк.');
      if (badge) {
        expect(row('Нагадування').contains(screen.getByText(badge)), status).toBe(true);
        // The accessible name, not only the text: a screen reader hears the problem on the link itself.
        const named = nav().getByRole('link', { name: new RegExp(`^Нагадування ${badge} 3 увімк\\.$`) });
        expect(named, status).toBe(row('Нагадування'));
      }
      cleanup();
    }
  });

  it('shows no badge while the push status is still being checked', () => {
    mocks.push.getPushStatus.mockReturnValue(new Promise(() => undefined));
    const memory = memoryLocation({ path: '/settings' });
    render(
      <Router hook={memory.hook}>
        <Route path="/settings/:section?" component={SettingsScreen} />
      </Router>,
    );
    expect(plain(row('Нагадування').textContent)).toBe('Нагадування 3 увімк.');
  });

  it('keeps the summaries in step with the data', async () => {
    useDataStore.setState({
      data: sampleData({
        settings: {
          ...sampleData().settings,
          goal: 58.5,
          kcalGoal: 1650,
          customTypes: ['Йога'],
          rem: { ...sampleData().settings.rem, measure: { ...sampleData().settings.rem.measure, on: false } },
        },
      }),
    });
    localStorage.setItem('legko.theme', 'dark');
    await renderReady('/settings', 'enabled');
    expect(plain(row('Нагадування').textContent)).toBe('Нагадування 2 увімк.');
    expect(plain(row('Цілі').textContent)).toBe('Цілі 58,5 кг · 1 650 ккал');
    expect(plain(row('Типи тренувань').textContent)).toBe('Типи тренувань 8 типів');
    expect(plain(row('Вигляд').textContent)).toBe('Вигляд Темна');

    patchSync({ pending: 3 });
    expect(plain(row('Дані і копія').textContent)).toBe('Дані і копія Очікує: 3');
    patchSync({ online: false, pending: 1 });
    expect(plain(row('Дані і копія').textContent)).toBe('Дані і копія Офлайн · 1 зміна');
    patchSync({ online: true, pending: 0, syncing: true });
    expect(plain(row('Дані і копія').textContent)).toBe('Дані і копія Синхронізую…');
  });

  it('opens a section from its row, with a back link to the list', async () => {
    const { memory } = await renderReady('/settings');
    fireEvent.click(row('Цілі'));
    expect(memory.history).toEqual(['/settings', '/settings/goals']);
    // The row stamps where it was opened from, for the back link (history.back instead of a new entry).
    expect(memory.state).toEqual({ legkoFrom: '/settings' });
    expect(screen.getByRole('heading', { level: 1, name: 'Цілі' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад: Налаштування' }).getAttribute('href')).toBe('/settings');
    expect(region('Мої цілі').getByText('60,0 кг')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Розділи налаштувань' })).toBeNull();
  });

  it('goes back with history.back() when the sub-page was opened from the list', async () => {
    window.history.replaceState({ legkoFrom: '/settings' }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = await renderReady('/settings/goals');
    // Opened from the list: the new title takes the focus.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Цілі' }));
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Налаштування' }));
    expect(back).toHaveBeenCalledOnce();
    expect(memory.history).toEqual(['/settings/goals']);
  });

  it('replace-navigates to the list after a deep link, and keeps the focus where it was', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = await renderReady('/settings/data');
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1, name: 'Дані і копія' }));
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Налаштування' }));
    expect(back).not.toHaveBeenCalled();
    expect(memory.history).toEqual(['/settings']);
    expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeTruthy();
    // The back link went away with the sub-page: the section's own row takes the focus.
    expect(document.activeElement).toBe(row('Дані і копія'));
  });

  describe('focus on the way back to the list', () => {
    it('lands on the row that opened the sub-page after «‹ Налаштування»', async () => {
      await renderReady('/settings');
      fireEvent.click(row('Цілі'));
      const backLink = screen.getByRole('link', { name: 'Назад: Налаштування' });
      backLink.focus();
      expect(document.activeElement).toBe(backLink);
      fireEvent.click(backLink);
      expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeTruthy();
      expect(document.activeElement).toBe(row('Цілі'));
    });

    it('lands on that row after the system back too (the focused title is gone with the sub-page)', async () => {
      window.history.replaceState({ legkoFrom: '/settings' }, '');
      const { memory } = await renderReady('/settings/workouts');
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Типи тренувань' }));
      act(() => memory.navigate('/settings', { replace: true }));
      expect(document.activeElement).toBe(row('Типи тренувань'));
    });

    it('leaves the focus alone when it did not go away (a keyboard user on the tab bar keeps it)', async () => {
      const { memory } = await renderReady('/settings/goals');
      const tab = document.createElement('a');
      tab.href = '/settings';
      document.body.append(tab);
      tab.focus();
      act(() => memory.navigate('/settings'));
      expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeTruthy();
      expect(document.activeElement).toBe(tab);
      tab.remove();
    });

    it('moves no focus on a fresh visit to the list, like the other tabs', async () => {
      await renderReady('/settings');
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('redirects an unknown section to the list', async () => {
    for (const path of ['/settings/foo', '/settings/Reminders']) {
      const { memory } = await renderReady(path);
      expect(memory.history, path).toEqual(['/settings']);
      expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeTruthy();
      cleanup();
    }
  });

  it('shares one push status between the sub-page and the list', async () => {
    mocks.push.enablePush.mockResolvedValue('enabled');
    await renderReady('/settings/reminders', 'default');
    fireEvent.click(region('Сповіщення на телефон').getByRole('button', { name: 'Увімкнути' }));
    await act(settle);
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Налаштування' }));
    expect(plain(row('Нагадування').textContent)).toBe('Нагадування 3 увімк.');
    expect(mocks.push.getPushStatus).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen — desktop (list + detail)', () => {
  beforeEach(desktop);

  it('shows the list next to the reminders at /settings, without changing the URL', async () => {
    const { memory } = await renderReady('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeTruthy();
    expect(row('Нагадування').getAttribute('aria-current')).toBe('page');
    expect(row('Цілі').getAttribute('aria-current')).toBeNull();
    const pane = region('Нагадування');
    expect(pane.getByRole('heading', { level: 2, name: 'Нагадування' })).toBeTruthy();
    expect(pane.getByRole('region', { name: 'Сповіщення на телефон' })).toBeTruthy();
    // The cards' own titles sit one level below the pane's <h2>.
    expect(pane.getByRole('heading', { level: 3, name: 'Сповіщення на телефон' })).toBeTruthy();
    expect(pane.getByRole('heading', { level: 3, name: 'Контрольне зважування' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вийти' })).toBeTruthy();
    // No back link and no second <h1> on desktop.
    expect(screen.queryByRole('link', { name: 'Назад: Налаштування' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(memory.history).toEqual(['/settings']);
  });

  it('shows the data card at /settings/data', async () => {
    await renderReady('/settings/data');
    expect(row('Дані і копія').getAttribute('aria-current')).toBe('page');
    expect(row('Нагадування').getAttribute('aria-current')).toBeNull();
    expect(region('Дані і копія').getByRole('region', { name: 'Дані' })).toBeTruthy();
    expect(region('Дані').getByText('Усе синхронізовано')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Сповіщення на телефон' })).toBeNull();
  });

  it('swaps the detail and the URL when another row is picked', async () => {
    const { memory } = await renderReady('/settings');
    fireEvent.click(row('Цілі'));
    expect(memory.history).toEqual(['/settings', '/settings/goals']);
    expect(row('Цілі').getAttribute('aria-current')).toBe('page');
    expect(region('Цілі').getByRole('region', { name: 'Мої цілі' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Нагадування' })).toBeNull();
  });

  it('adds no history entry when the row of the section on screen is clicked again', async () => {
    const atGoals = await renderReady('/settings/goals');
    fireEvent.click(row('Цілі'));
    fireEvent.click(row('Цілі'));
    expect(atGoals.memory.history).toEqual(['/settings/goals']);
    expect(row('Цілі').getAttribute('aria-current')).toBe('page');
    cleanup();

    // `/settings` shows the reminders: their row swaps in the section's own URL instead of stacking a twin page.
    const atRoot = await renderReady('/settings');
    fireEvent.click(row('Нагадування'));
    expect(atRoot.memory.history).toEqual(['/settings/reminders']);
    expect(row('Нагадування').getAttribute('aria-current')).toBe('page');
    expect(region('Нагадування').getByRole('region', { name: 'Сповіщення на телефон' })).toBeTruthy();
  });

  it('keeps the push badge a chip on the selected (tinted) «Нагадування» row', async () => {
    await renderReady('/settings', 'default');
    const badge = screen.getByText('Сповіщення вимкнені');
    // The hook of `.nav [aria-current] .badge` (lifted onto --card, see settingsStyles.test.ts).
    expect(badge.classList.contains(listStyles.badge ?? 'missing')).toBe(true);
    expect(badge.closest('[aria-current="page"]')).toBe(row('Нагадування'));
    expect(badge.closest('nav')).toBe(screen.getByRole('navigation', { name: 'Розділи налаштувань' }));
    cleanup();

    // Another section on screen: the badge row is not selected, the pill keeps its own tint.
    await renderReady('/settings/goals', 'default');
    const other = screen.getByText('Сповіщення вимкнені');
    expect(other.classList.contains(listStyles.badge ?? 'missing')).toBe(true);
    expect(other.closest('[aria-current]')).toBeNull();
  });

  it('names the «Вигляд» pane once: the card inside it is no second region «Вигляд»', async () => {
    await renderReady('/settings/appearance');
    expect(screen.getAllByRole('region', { name: 'Вигляд' })).toHaveLength(1);
    const pane = region('Вигляд');
    expect(pane.getByRole('heading', { level: 2, name: 'Вигляд' })).toBeTruthy();
    expect(pane.getByRole('radiogroup', { name: 'Тема' })).toBeTruthy();
    expect(pane.getByText('Тема на цьому пристрої')).toBeTruthy();
  });

  it('clears the badge in the list as soon as push is enabled in the pane', async () => {
    mocks.push.enablePush.mockResolvedValue('enabled');
    await renderReady('/settings/reminders', 'default');
    expect(plain(row('Нагадування').textContent)).toBe('Нагадування Сповіщення вимкнені 3 увімк.');
    fireEvent.click(region('Сповіщення на телефон').getByRole('button', { name: 'Увімкнути' }));
    await act(settle);
    expect(plain(row('Нагадування').textContent)).toBe('Нагадування 3 увімк.');
    expect(region('Сповіщення на телефон').getByRole('button', { name: 'Тест' })).toBeTruthy();
  });

  it('updates the list’s «Вигляд» row when the theme is changed in the pane next to it', async () => {
    await renderReady('/settings/appearance');
    expect(plain(row('Вигляд').textContent)).toBe('Вигляд Авто');
    fireEvent.click(screen.getByRole('radio', { name: 'Темна' }));
    expect(plain(row('Вигляд').textContent)).toBe('Вигляд Темна');
    expect(screen.getByRole('radio', { name: 'Темна' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('Нагадування (/settings/reminders)', () => {
  it('renders the notifications panel and the three reminder cards', async () => {
    await renderReady('/settings/reminders');
    expect(screen.getByRole('heading', { level: 1, name: 'Нагадування' })).toBeTruthy();
    expect(region('Сповіщення на телефон').getByRole('heading', { level: 2 })).toBeTruthy();
    expect(region('Тренування').getByText('Пн, Ср, Пт · 18:00')).toBeTruthy();
    expect(region('Контрольне зважування').getByText('Раз на тиждень · понеділок')).toBeTruthy();
    expect(region('Заміри тіла').getByText('Раз на тиждень · понеділок')).toBeTruthy();
  });

  describe('notifications', () => {
    it('enables push straight from the tap and confirms with a toast', async () => {
      const result = deferred<PushStatus>();
      mocks.push.enablePush.mockReturnValue(result.promise);
      await renderReady('/settings/reminders', 'default');
      const panel = region('Сповіщення на телефон');
      expect(panel.getByText('Дозволь Легко надсилати нагадування')).toBeTruthy();

      fireEvent.click(panel.getByRole('button', { name: 'Увімкнути' }));
      // Synchronously, inside the click: iOS needs the user gesture.
      expect(mocks.push.enablePush).toHaveBeenCalledTimes(1);
      expect(panel.getByRole<HTMLButtonElement>('button', { name: '…' }).disabled).toBe(true);

      await act(async () => result.resolve('enabled'));
      expect(toast()).toBe('Сповіщення увімкнено');
      expect(panel.getByRole('button', { name: 'Тест' })).toBeTruthy();
      expect(panel.getByText('Нагадування приходять, навіть коли застосунок закритий')).toBeTruthy();
    });

    it('shows a Ukrainian error when subscribing fails and re-checks the status', async () => {
      mocks.push.enablePush.mockRejectedValue(
        new ApiError(503, 'push_unavailable', 'Сповіщення недоступні на сервері'),
      );
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await renderReady('/settings/reminders', 'default');
      fireEvent.click(screen.getByRole('button', { name: 'Увімкнути' }));
      await act(settle);
      expect(toast()).toBe('Сповіщення недоступні на сервері');
      expect(mocks.push.getPushStatus).toHaveBeenCalledTimes(2);
    });

    it('sends a test notification and can turn push off on this device', async () => {
      mocks.push.sendTestPush.mockResolvedValue(1);
      mocks.push.disablePush.mockResolvedValue();
      await renderReady('/settings/reminders', 'enabled');

      fireEvent.click(screen.getByRole('button', { name: 'Тест' }));
      await act(settle);
      expect(mocks.push.sendTestPush).toHaveBeenCalled();
      expect(toast()).toBe('Надіслано — перевір сповіщення');

      mocks.push.getPushStatus.mockResolvedValue('default');
      fireEvent.click(screen.getByRole('button', { name: 'Вимкнути на цьому пристрої' }));
      await act(settle);
      expect(mocks.push.disablePush).toHaveBeenCalled();
      expect(toast()).toBe('Сповіщення на цьому пристрої вимкнено');
      expect(screen.getByRole('button', { name: 'Увімкнути' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Вимкнути на цьому пристрої' })).toBeNull();
    });

    it('opens the install guide on an iPhone browser tab', async () => {
      await renderReady('/settings/reminders', 'needs-install');
      fireEvent.click(screen.getByRole('button', { name: 'Як?' }));
      expect(useUiStore.getState().sheet?.mode).toBe('install');
    });

    it('disables the button when notifications are blocked', async () => {
      await renderReady('/settings/reminders', 'denied');
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Заблоковано' }).disabled).toBe(true);
      expect(
        screen.getByText('Сповіщення заборонені. Увімкни їх у Параметрах → Сповіщення → Легко'),
      ).toBeTruthy();
    });

    it('re-checks when the app comes back to the foreground', async () => {
      await renderReady('/settings/reminders', 'denied');
      mocks.push.getPushStatus.mockResolvedValue('default');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
      });
      expect(mocks.push.getPushStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: 'Увімкнути' })).toBeTruthy();
    });
  });

  describe('reminders', () => {
    it('toggles a reminder and edits its days and time', async () => {
      await renderReady('/settings/reminders');
      const workout = region('Тренування');

      const sw = workout.getByRole('switch', { name: 'Тренування' });
      fireEvent.click(sw);
      expect(settings().rem.workout.on).toBe(false);
      expect(sw.getAttribute('aria-checked')).toBe('false');

      fireEvent.click(workout.getByRole('button', { name: 'Вівторок' }));
      expect(settings().rem.workout.days).toEqual([1, 2, 3, 5]);
      expect(workout.getByText('Пн, Вт, Ср, Пт · 18:00')).toBeTruthy();

      fireEvent.change(workout.getByLabelText('Час'), { target: { value: '19:30' } });
      expect(settings().rem.workout.time).toBe('19:30');
      expect(workout.getByText('Пн, Вт, Ср, Пт · 19:30')).toBeTruthy();
    });

    it('picks a single day for the weekly reminders', async () => {
      await renderReady('/settings/reminders');
      const weigh = region('Контрольне зважування');
      fireEvent.click(weigh.getByRole('radio', { name: 'Середа' }));
      expect(settings().rem.weigh.day).toBe(3);
      expect(weigh.getByText('Раз на тиждень · середа')).toBeTruthy();
      expect(settings().rem.measure.day).toBe(1);
    });
  });
});

describe('Цілі (/settings/goals)', () => {
  it('steps the goals', async () => {
    await renderReady('/settings/goals');
    const goals = region('Мої цілі');
    // Headless card: the page title names the section.
    expect(goals.queryByRole('heading')).toBeNull();
    expect(goals.getByText('60,0 кг')).toBeTruthy();
    expect(goals.getByText(/^1\s700 ккал$/)).toBeTruthy();
    fireEvent.click(goals.getByRole('button', { name: 'Збільшити цільову вагу' }));
    expect(settings().goal).toBe(60.5);
    expect(goals.getByText('60,5 кг')).toBeTruthy();
    fireEvent.click(goals.getByRole('button', { name: 'Зменшити калорії на день' }));
    expect(settings().kcalGoal).toBe(1650);
  });
});

describe('Типи тренувань (/settings/workouts)', () => {
  it('adds and removes custom workout types', async () => {
    await renderReady('/settings/workouts');
    const types = region('Мої тренування');
    expect(types.queryByRole('heading')).toBeNull();
    const intro = types.getByText('Типи, які можна вибрати в записі дня');
    const list = types.getByRole('list', { name: 'Типи, які можна вибрати в записі дня' });
    // The intro comes first, the add form last.
    expect(intro.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const input = types.getByLabelText('Свій тип тренування');
    expect(list.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const add = types.getByRole<HTMLButtonElement>('button', { name: 'Додати' });
    expect(add.disabled).toBe(true);
    expect(types.getByText('Кардіо')).toBeTruthy();

    fireEvent.change(input, { target: { value: '  Йога ' } });
    fireEvent.click(add);
    expect(settings().customTypes).toEqual(['Йога']);
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.change(input, { target: { value: 'КАРДІО' } });
    fireEvent.click(add);
    expect(types.getByRole('alert').textContent).toBe('«Кардіо» вже є у списку');
    expect(settings().customTypes).toEqual(['Йога']);

    fireEvent.click(types.getByRole('button', { name: 'Видалити «Йога»' }));
    expect(settings().customTypes).toEqual([]);
  });
});

describe('Вигляд (/settings/appearance)', () => {
  it('switches the theme on this device', async () => {
    await renderReady('/settings/appearance');
    const card = region('Вигляд');
    expect(card.getByText('Тема на цьому пристрої')).toBeTruthy();
    fireEvent.click(card.getByRole('radio', { name: 'Темна' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('legko.theme')).toBe('dark');
    fireEvent.click(card.getByRole('radio', { name: 'Авто' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('Дані і копія (/settings/data)', () => {
  const pickFile = (content: string) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const file = new File([content], 'legko-2026-10-09.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('shows the sync state first, and the backup link', async () => {
    await renderReady('/settings/data');
    const data = region('Дані');
    const status = data.getByText('Усе синхронізовано');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.parentElement?.firstElementChild).toBe(status);
    const link = data.getByRole('link', { name: 'Завантажити резервну копію' });
    expect(link.getAttribute('href')).toBe('/api/export');
    expect(link.hasAttribute('download')).toBe(true);
    expect(data.getByText('Фото їжі зберігаються на сервері й не входять у файл копії')).toBeTruthy();

    patchSync({ pending: 3 });
    expect(data.getByText('Очікує синхронізації: 3')).toBeTruthy();
    patchSync({ online: false });
    expect(data.getByText('Офлайн — 3 зміни чекають на інтернет')).toBeTruthy();
  });

  it('restores a backup after confirming in the app, never with window.confirm', async () => {
    const importAll = vi.spyOn(dataActions, 'importAll').mockResolvedValue();
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    const native = vi.spyOn(window, 'confirm');
    await renderReady('/settings/data');

    pickFile(JSON.stringify(sampleData({ weights: [{ date: '2026-10-05', kg: 65.4 }] })));
    await act(settle);

    expect(confirm).toHaveBeenCalledWith({
      title: 'Відновити з резервної копії?',
      body: 'Усі поточні записи буде замінено даними з файлу.',
      confirmLabel: 'Відновити',
      destructive: true,
    });
    expect(native).not.toHaveBeenCalled();
    expect(importAll).toHaveBeenCalledTimes(1);
    expect(importAll.mock.calls[0]?.[0].weights).toEqual([{ date: '2026-10-05', kg: 65.4 }]);
    expect(toast()).toBe('Дані відновлено');
  });

  it('does nothing when the restore is cancelled, and rejects foreign files', async () => {
    const importAll = vi.spyOn(dataActions, 'importAll').mockResolvedValue();
    await renderReady('/settings/data');

    pickFile(JSON.stringify(sampleData()));
    await act(settle);
    // The real in-app dialog is waiting for an answer.
    const asked = useUiStore.getState().confirm;
    expect(asked?.title).toBe('Відновити з резервної копії?');
    await act(async () => {
      asked?.resolve(false);
      await settle();
    });
    expect(useUiStore.getState().confirm).toBeNull();
    expect(importAll).not.toHaveBeenCalled();

    pickFile('{"not":"a backup"}');
    await act(settle);
    expect(useUiStore.getState().confirm).toBeNull();
    expect(toast()).toBe('Файл не схожий на резервну копію «Легко»');
  });

  it('shows the server error when the restore fails', async () => {
    vi.spyOn(dataActions, 'importAll').mockRejectedValue(
      new ApiError(0, 'network', 'Немає зʼєднання з сервером'),
    );
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderReady('/settings/data');

    pickFile(JSON.stringify(sampleData()));
    await act(settle);
    expect(toast()).toBe('Немає зʼєднання з сервером');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Відновити з копії' }).disabled).toBe(false);
  });

  describe('in the installed iPhone app', () => {
    const shareHost = (share: ShareHost['share'] = () => Promise.resolve()) => {
      const h = { iosApp: true, share: vi.fn(share), canShare: vi.fn(() => true) };
      vi.spyOn(backupDevice, 'host').mockReturnValue(h);
      return h;
    };
    const saveButton = (name = 'Завантажити резервну копію') =>
      region('Дані').getByRole<HTMLButtonElement>('button', { name });
    const sharedFile = (h: ReturnType<typeof shareHost>, call = 0): File => {
      const file = h.share.mock.calls[call]?.[0]?.files?.[0];
      if (!file) throw new Error('nothing shared');
      return file;
    };
    const read = (file: File) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(file);
      });

    it('hands the file to the share sheet instead of a download link that would trap the app', async () => {
      const h = shareHost();
      await renderReady('/settings/data');
      expect(region('Дані').queryByRole('link')).toBeNull();

      fireEvent.click(saveButton());
      // Synchronously, inside the tap: iOS only shows the share sheet for a user gesture.
      expect(h.share).toHaveBeenCalledTimes(1);
      expect(mocks.flushNow).not.toHaveBeenCalled();
      const file = sharedFile(h);
      expect(file.name).toBe(`legko-${todayISO()}.json`);
      expect(file.type).toBe('application/json');
      expect(parseBackup(await read(file))).toEqual(useDataStore.getState().data);

      await act(settle);
      expect(toast()).toBeUndefined();
      expect(saveButton().disabled).toBe(false);
    });

    it('sends queued changes first, then opens the share sheet', async () => {
      const h = shareHost();
      const flushed = deferred<boolean>();
      mocks.flushNow.mockReturnValue(flushed.promise);
      await renderReady('/settings/data');
      patchSync({ pending: 2 });

      fireEvent.click(saveButton());
      expect(mocks.flushNow).toHaveBeenCalledTimes(1);
      expect(h.share).not.toHaveBeenCalled();
      expect(saveButton('Готую копію…').disabled).toBe(true);

      patchSync({ pending: 0 });
      await act(async () => {
        flushed.resolve(true);
        await settle();
      });
      expect(h.share).toHaveBeenCalledTimes(1);
      expect(saveButton().disabled).toBe(false);
    });

    it('asks for one more tap when iOS refuses the share sheet after the wait', async () => {
      const h = shareHost();
      h.share.mockRejectedValueOnce(new DOMException('needs a gesture', 'NotAllowedError'));
      mocks.flushNow.mockImplementation(() => {
        useDataStore.setState((st) => ({ sync: { ...st.sync, pending: 0 } }));
        return Promise.resolve(true);
      });
      await renderReady('/settings/data');
      patchSync({ pending: 1 });

      fireEvent.click(saveButton());
      await act(settle);
      expect(toast()).toBe('Копія готова — натисни ще раз, щоб зберегти');

      fireEvent.click(saveButton('Поділитися файлом'));
      expect(h.share).toHaveBeenCalledTimes(2);
      expect(mocks.flushNow).toHaveBeenCalledTimes(1);
      await act(settle);
      expect(saveButton().disabled).toBe(false);
    });

    it('drops the prepared copy when something changes before the second tap', async () => {
      const h = shareHost();
      h.share.mockRejectedValueOnce(new DOMException('needs a gesture', 'NotAllowedError'));
      await renderReady('/settings/data');
      patchSync({ pending: 1 });
      mocks.flushNow.mockImplementation(() => {
        useDataStore.setState((st) => ({ sync: { ...st.sync, pending: 0 } }));
        return Promise.resolve(true);
      });
      fireEvent.click(saveButton());
      await act(settle);
      expect(saveButton('Поділитися файлом')).toBeTruthy();

      patchSync({ pending: 1 });
      fireEvent.click(saveButton());
      expect(mocks.flushNow).toHaveBeenCalledTimes(2);
      await act(settle);
      expect(h.share).toHaveBeenCalledTimes(2);
    });

    it('stays quiet when she closes the share sheet, and says so when sharing fails', async () => {
      const h = shareHost();
      h.share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
      h.share.mockRejectedValueOnce(new TypeError('no'));
      await renderReady('/settings/data');

      fireEvent.click(saveButton());
      await act(settle);
      expect(toast()).toBeUndefined();

      fireEvent.click(saveButton());
      await act(settle);
      expect(toast()).toBe('Не вдалося зберегти копію. Спробуй ще раз');
    });

    it('needs the connection and a finished sync', async () => {
      const h = shareHost();
      mocks.flushNow.mockResolvedValue(false);
      await renderReady('/settings/data');

      patchSync({ online: false });
      fireEvent.click(saveButton());
      expect(toast()).toBe('Немає інтернету — копію можна завантажити, коли зʼявиться звʼязок');

      patchSync({ online: true, pending: 1 });
      fireEvent.click(saveButton());
      await act(settle);
      expect(toast()).toBe('Не всі зміни встигли синхронізуватися — спробуй ще раз пізніше');
      expect(saveButton().disabled).toBe(false);
      expect(h.share).not.toHaveBeenCalled();
    });

    it('points to Safari on an iOS that cannot share files', async () => {
      vi.spyOn(backupDevice, 'host').mockReturnValue({ iosApp: true });
      await renderReady('/settings/data');
      expect(region('Дані').queryByRole('link')).toBeNull();
      fireEvent.click(saveButton());
      expect(toast()).toBe('На цьому iPhone копію можна завантажити лише в Safari');
    });
  });
});

describe('«Вийти» (/settings)', () => {
  const logoutButton = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

  it('logs out from its own row', async () => {
    const logout = vi.spyOn(authActions, 'logout').mockResolvedValue(true);
    await renderReady('/settings');
    const button = logoutButton('Вийти');
    // Its own group, after the section links.
    expect(button.closest('nav')).toBeNull();
    fireEvent.click(button);
    expect(logout).toHaveBeenCalledTimes(1);
    await act(settle);
  });

  it('says «Виходжу…» only once she has confirmed the logout', async () => {
    const leaving = deferred<boolean>();
    // Like authActions.logout: asks in the app's dialog, then logs out.
    vi.spyOn(authActions, 'logout').mockImplementation(async () =>
      (await ui.confirm({ title: 'Вийти з Легко на цьому пристрої?' })) ? leaving.promise : false,
    );
    await renderReady('/settings');

    fireEvent.click(logoutButton('Вийти'));
    await act(settle);
    expect(logoutButton('Вийти').disabled).toBe(true);
    await act(async () => {
      useUiStore.getState().confirm?.resolve(false);
      await settle();
    });
    expect(logoutButton('Вийти').disabled).toBe(false);

    fireEvent.click(logoutButton('Вийти'));
    await act(async () => {
      await settle();
      useUiStore.getState().confirm?.resolve(true);
      await settle();
    });
    expect(logoutButton('Виходжу…').disabled).toBe(true);
    await act(async () => {
      leaving.resolve(true);
      await settle();
    });
  });

  describe('focus after the dialog', () => {
    /** The real `authActions.logout()` and the real dialog (the shell mounts `ConfirmHost` once). */
    async function openLogoutDialog() {
      await renderReady('/settings');
      render(<ConfirmHost />);
      const button = logoutButton('Вийти');
      button.focus();
      fireEvent.click(button);
      await act(settle);
      const dialog = within(screen.getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' }));
      // Destructive: the dialog starts on «Скасувати»; the row waits, disabled, behind it.
      expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Скасувати' }));
      expect(button.disabled).toBe(true);
      return { button, dialog };
    }

    it('gives the focus back to «Вийти» after «Скасувати»', async () => {
      const { button, dialog } = await openLogoutDialog();
      fireEvent.click(dialog.getByRole('button', { name: 'Скасувати' }));
      await act(settle);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(logoutButton('Вийти')).toBe(button);
      expect(button.disabled).toBe(false);
      expect(document.activeElement).toBe(button);
      expect(mocks.api.logout).not.toHaveBeenCalled();
    });

    it('gives the focus back to «Вийти» after Escape', async () => {
      const { button } = await openLogoutDialog();
      fireEvent.keyDown(window, { key: 'Escape' });
      await act(settle);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(button.disabled).toBe(false);
      expect(document.activeElement).toBe(button);
    });

    it('takes no focus after a tap that never focused the row (iPhone Safari)', async () => {
      await renderReady('/settings');
      render(<ConfirmHost />);
      fireEvent.click(logoutButton('Вийти'));
      await act(settle);
      fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
      await act(settle);
      expect(logoutButton('Вийти').disabled).toBe(false);
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('says so when the logout fails', async () => {
    vi.spyOn(authActions, 'logout').mockRejectedValue(new Error('offline'));
    await renderReady('/settings');
    fireEvent.click(logoutButton('Вийти'));
    await act(settle);
    expect(toast()).toBe('Не вдалося вийти. Спробуй ще раз');
    expect(logoutButton('Вийти').disabled).toBe(false);
  });
});
