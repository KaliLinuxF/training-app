import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authActions } from '@/auth/auth';
import type * as ApiModule from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { PushStatus } from '@/lib/push';
import { dataActions, useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { deferred, sampleData, settle } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { installMatchMedia } from '@/ui/internal/testing';
import { RemindersScreen } from './RemindersScreen';

const mocks = vi.hoisted(() => ({
  push: {
    getPushStatus: vi.fn<() => Promise<PushStatus>>(),
    enablePush: vi.fn<() => Promise<PushStatus>>(),
    disablePush: vi.fn<() => Promise<void>>(),
    sendTestPush: vi.fn<() => Promise<number>>(),
    syncPushSubscription: vi.fn<() => Promise<void>>(),
  },
  api: { sendOps: vi.fn(), getData: vi.fn(), importData: vi.fn(), logout: vi.fn() },
}));

vi.mock('@/lib/push', () => mocks.push);
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { ...mocks.api, exportUrl: '/api/export' },
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const settings = () => useDataStore.getState().data.settings;
const toast = () => useUiStore.getState().toast?.text;

function renderScreen(status: PushStatus = 'default') {
  mocks.push.getPushStatus.mockResolvedValue(status);
  return render(<RemindersScreen />);
}

/** Renders and waits for the push status check to land. */
async function renderReady(status: PushStatus = 'default') {
  const view = renderScreen(status);
  await act(settle);
  return view;
}

const card = (title: string) => {
  const heading = screen.getByRole('heading', { name: title });
  const section = heading.closest('section');
  if (!section) throw new Error(`no card for ${title}`);
  return within(section);
};

beforeEach(() => {
  installMatchMedia();
  for (const fn of Object.values(mocks.push)) fn.mockReset();
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.sendOps.mockReturnValue(new Promise(() => undefined));
  useDataStore.setState({ data: sampleData(), sync: { ...initialSyncState(), loaded: true } });
  useUiStore.setState({ sheet: null, toast: null });
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RemindersScreen', () => {
  it('renders the prototype header, reminder cards and goals', async () => {
    await renderReady();
    expect(screen.getByRole('heading', { level: 1, name: 'Нагадування' })).toBeTruthy();
    expect(screen.getByText('Дні, час і цілі')).toBeTruthy();
    expect(card('Тренування').getByText('Пн, Ср, Пт · 18:00')).toBeTruthy();
    expect(card('Контрольне зважування').getByText('Раз на тиждень · понеділок')).toBeTruthy();
    expect(card('Заміри тіла').getByText('Раз на тиждень · понеділок')).toBeTruthy();
    expect(card('Мої цілі').getByText('60,0 кг')).toBeTruthy();
    expect(card('Мої цілі').getByText(/^1\s700 ккал$/)).toBeTruthy();
    expect(screen.getByText('Легко · трекер схуднення')).toBeTruthy();
  });

  describe('notifications', () => {
    it('enables push straight from the tap and confirms with a toast', async () => {
      const result = deferred<PushStatus>();
      mocks.push.enablePush.mockReturnValue(result.promise);
      await renderReady('default');
      const panel = card('Сповіщення на телефон');
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
      mocks.push.enablePush.mockRejectedValue(new ApiError(503, 'push_unavailable', 'Сповіщення недоступні на сервері'));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await renderReady('default');
      fireEvent.click(screen.getByRole('button', { name: 'Увімкнути' }));
      await act(settle);
      expect(toast()).toBe('Сповіщення недоступні на сервері');
      expect(mocks.push.getPushStatus).toHaveBeenCalledTimes(2);
    });

    it('sends a test notification and can turn push off on this device', async () => {
      mocks.push.sendTestPush.mockResolvedValue(1);
      mocks.push.disablePush.mockResolvedValue();
      await renderReady('enabled');

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
      await renderReady('needs-install');
      fireEvent.click(screen.getByRole('button', { name: 'Як увімкнути' }));
      expect(useUiStore.getState().sheet?.mode).toBe('install');
    });

    it('disables the button when notifications are blocked', async () => {
      await renderReady('denied');
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Заблоковано' }).disabled).toBe(true);
      expect(screen.getByText('Сповіщення заборонені. Увімкни їх у Параметрах → Сповіщення → Легко')).toBeTruthy();
    });

    it('re-checks when the app comes back to the foreground', async () => {
      await renderReady('denied');
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
      await renderReady();
      const workout = card('Тренування');

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
      await renderReady();
      const weigh = card('Контрольне зважування');
      fireEvent.click(weigh.getByRole('radio', { name: 'Середа' }));
      expect(settings().rem.weigh.day).toBe(3);
      expect(weigh.getByText('Раз на тиждень · середа')).toBeTruthy();
      expect(settings().rem.measure.day).toBe(1);
    });
  });

  it('steps the goals', async () => {
    await renderReady();
    const goals = card('Мої цілі');
    fireEvent.click(goals.getByRole('button', { name: 'Збільшити цільову вагу' }));
    expect(settings().goal).toBe(60.5);
    expect(goals.getByText('60,5 кг')).toBeTruthy();
    fireEvent.click(goals.getByRole('button', { name: 'Зменшити калорії на день' }));
    expect(settings().kcalGoal).toBe(1650);
  });

  it('adds and removes custom workout types', async () => {
    await renderReady();
    const types = card('Мої тренування');
    const input = types.getByLabelText('Свій тип тренування');
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

  it('switches the theme on this device', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('radio', { name: 'Темна' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('legko.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  describe('data', () => {
    const pickFile = (content: string) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error('no file input');
      const file = new File([content], 'legko-2026-10-09.json', { type: 'application/json' });
      fireEvent.change(input, { target: { files: [file] } });
    };

    it('shows the sync state and the backup link', async () => {
      await renderReady();
      const data = card('Дані');
      expect(data.getByText('Усе синхронізовано')).toBeTruthy();
      const link = data.getByRole('link', { name: 'Завантажити резервну копію' });
      expect(link.getAttribute('href')).toBe('/api/export');
      expect(link.hasAttribute('download')).toBe(true);
      expect(data.getByText('Фото їжі зберігаються на сервері й не входять у файл копії')).toBeTruthy();

      act(() => useDataStore.setState((st) => ({ sync: { ...st.sync, pending: 3 } })));
      expect(data.getByText('Очікує синхронізації: 3')).toBeTruthy();
      act(() => useDataStore.setState((st) => ({ sync: { ...st.sync, online: false } })));
      expect(data.getByText('Офлайн — 3 зміни чекають на інтернет')).toBeTruthy();
    });

    it('restores a backup after confirming', async () => {
      const importAll = vi.spyOn(dataActions, 'importAll').mockResolvedValue();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      await renderReady();

      pickFile(JSON.stringify(sampleData({ weights: [{ date: '2026-10-05', kg: 65.4 }] })));
      await act(settle);

      expect(confirm).toHaveBeenCalledWith('Це замінить усі записи даними з файлу. Продовжити?');
      expect(importAll).toHaveBeenCalledTimes(1);
      expect(importAll.mock.calls[0]?.[0].weights).toEqual([{ date: '2026-10-05', kg: 65.4 }]);
      expect(toast()).toBe('Дані відновлено');
    });

    it('does nothing when the restore is cancelled, and rejects foreign files', async () => {
      const importAll = vi.spyOn(dataActions, 'importAll').mockResolvedValue();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await renderReady();

      pickFile(JSON.stringify(sampleData()));
      await act(settle);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(importAll).not.toHaveBeenCalled();

      pickFile('{"not":"a backup"}');
      await act(settle);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(toast()).toBe('Файл не схожий на резервну копію «Легко»');
    });

    it('shows the server error when the restore fails', async () => {
      vi.spyOn(dataActions, 'importAll').mockRejectedValue(new ApiError(0, 'network', 'Немає зʼєднання з сервером'));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await renderReady();

      pickFile(JSON.stringify(sampleData()));
      await act(settle);
      expect(toast()).toBe('Немає зʼєднання з сервером');
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Відновити з копії' }).disabled).toBe(false);
    });
  });

  it('logs out', async () => {
    const logout = vi.spyOn(authActions, 'logout').mockResolvedValue(true);
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));
    expect(logout).toHaveBeenCalledTimes(1);
    await act(settle);
  });
});
