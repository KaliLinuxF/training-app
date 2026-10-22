import type {
  AdminInvite,
  AdminOverview,
  InviteCreatedResponse,
  LinkResponse,
  OkResponse,
  SessionUser,
  UserRole,
} from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type * as AuthModule from '@/auth/auth';
import { useAuthStore } from '@/auth/auth';
import type * as ApiModule from '@/lib/api';
import { ApiError } from '@/lib/api';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { deferred, sampleData, sessionUser, settle } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { installMatchMedia } from '@/ui/internal/testing';
import { resetAdminOverview } from './adminOverview';
import { adminInvite, adminOverview, adminUser, idOf } from './testing';
import { UsersPage } from './UsersPage';

const mocks = vi.hoisted(() => ({
  auth: { refreshUser: vi.fn<() => Promise<void>>() },
  admin: {
    overview: vi.fn<() => Promise<AdminOverview>>(),
    createInvite: vi.fn<(req: { note?: string }) => Promise<InviteCreatedResponse>>(),
    revokeInvite: vi.fn<(req: { id: string }) => Promise<OkResponse>>(),
    resetLink: vi.fn<(req: { userId: string }) => Promise<LinkResponse>>(),
    setRole: vi.fn<(req: { userId: string; role: UserRole }) => Promise<OkResponse>>(),
    setDisabled: vi.fn<(req: { userId: string; disabled: boolean }) => Promise<OkResponse>>(),
    deleteUser: vi.fn<(req: { userId: string; confirmUsername: string }) => Promise<OkResponse>>(),
    setUserAiLimit: vi.fn<(req: { userId: string; limit: number | null }) => Promise<OkResponse>>(),
    setAiLimits: vi.fn<(req: { perUser: number; global: number }) => Promise<OkResponse>>(),
  },
}));

vi.mock('@/auth/auth', async (importOriginal) => {
  const real = await importOriginal<typeof AuthModule>();
  return { ...real, authActions: { ...real.authActions, ...mocks.auth } };
});
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { admin: mocks.admin },
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const ADMIN: SessionUser = sessionUser({ id: idOf('admin'), username: 'admin', role: 'admin' });
const TOKEN = 'Qm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF';
const OK: OkResponse = { ok: true };

const toast = () => useUiStore.getState().toast?.text;
const region = (name: string | RegExp) => within(screen.getByRole('region', { name }));
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const button = (scope: ReturnType<typeof region>, name: string | RegExp) =>
  scope.getByRole('button', { name }) as HTMLButtonElement;
const setOnline = (online: boolean) =>
  act(() => useDataStore.setState((st) => ({ sync: { ...st.sync, online } })));

/**
 * What a browser does when the focused control gets disabled while it works: the focus drops to <body>. jsdom keeps
 * it on the disabled control (and ignores `blur()` there), so it is parked on a stand-in that then goes away.
 * Without the fix it would stay lost.
 */
const dropFocus = () =>
  act(() => {
    const standIn = document.createElement('input');
    document.body.append(standIn);
    standIn.focus();
    standIn.remove();
  });

/** Presses a control the way a browser does: it takes the focus first. */
function press(el: HTMLElement) {
  el.focus();
  fireEvent.click(el);
}

function inviteCreated(patch: Partial<InviteCreatedResponse> = {}): InviteCreatedResponse {
  const invite = adminInvite({ id: 'c'.repeat(32), note: '' });
  return { ok: true, path: `/invite#${TOKEN}`, expiresAt: invite.expiresAt, invite, ...patch };
}

async function renderPage(overview: AdminOverview = adminOverview()) {
  mocks.admin.overview.mockResolvedValue(overview);
  const memory = memoryLocation({ path: '/settings/users', record: true });
  const view = render(
    <Router hook={memory.hook}>
      <Route path="/settings/users">
        <UsersPage headingLevel="h2" />
      </Route>
    </Router>,
  );
  await act(settle);
  return { ...view, memory };
}

/** The open user sheet (a dialog named by the username). */
const sheet = (username: string) => within(screen.getByRole('dialog', { name: username }));

async function openSheet(username: string) {
  fireEvent.click(region(/^Акаунти · /).getByRole('button', { name: new RegExp(`^${username}`) }));
  await act(settle);
  return sheet(username);
}

let clipboard: { writeText: ReturnType<typeof vi.fn> } | undefined;

function setClipboard(writeText?: (text: string) => Promise<void>) {
  clipboard = writeText ? { writeText: vi.fn(writeText) } : undefined;
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function setShare(share?: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'share', { value: share ? vi.fn(share) : undefined, configurable: true });
}

beforeEach(() => {
  installMatchMedia();
  for (const fn of Object.values(mocks.admin)) fn.mockReset().mockResolvedValue(OK as never);
  mocks.auth.refreshUser.mockReset().mockResolvedValue();
  resetAdminOverview();
  useAuthStore.setState({ status: 'authed', offline: false, user: ADMIN });
  useDataStore.setState({ data: sampleData(), sync: { ...initialSyncState(), loaded: true, online: true } });
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  setClipboard();
  setShare();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('«Користувачі» — the overview', () => {
  it('says «Завантажую…» first, then shows the invites, the accounts and the AI limits', async () => {
    const answer = deferred<AdminOverview>();
    mocks.admin.overview.mockReturnValue(answer.promise);
    render(<UsersPage headingLevel="h2" />);
    expect(screen.getByRole('status').textContent).toBe('Завантажую…');
    // Inviting does not wait for the list.
    expect(screen.getByRole('region', { name: 'Запросити людину' })).toBeTruthy();

    const now = Date.now();
    await act(async () => {
      answer.resolve(
        adminOverview({
          users: [
            adminUser('admin', { role: 'admin', self: true, lastSeenAt: now }),
            adminUser('anna', {
              lastSeenAt: now,
              ai: { today: 3, last30Days: 41, limit: 40, customLimit: null },
            }),
            adminUser('olya', { status: 'disabled' }),
            adminUser('new', { status: 'pending' }),
          ],
          invites: [
            adminInvite({ id: '1'.repeat(32), note: 'для Олі' }),
            adminInvite({ id: '2'.repeat(32), note: '', role: 'admin', createdBy: null }),
          ],
        }),
      );
      await settle();
    });
    expect(screen.queryByText('Завантажую…')).toBeNull();

    const invites = region('Запрошення · 2');
    expect(invites.getByRole('heading', { level: 2, name: 'Запрошення · 2' })).toBeTruthy();
    const inviteRows = invites.getAllByRole('listitem');
    // The row itself (the «Скасувати» button sits next to it).
    expect(inviteRows.map((li) => plain(li.firstElementChild?.textContent))).toEqual([
      'для Олі до 28 жовтня · від admin',
      'Без підпису Адмін до 28 жовтня · з консолі',
    ]);
    expect(invites.getByRole('button', { name: 'Скасувати запрошення «для Олі»' })).toBeTruthy();
    expect(invites.getByRole('button', { name: 'Скасувати запрошення «Без підпису»' })).toBeTruthy();

    const accounts = region('Акаунти · 4');
    const rows = accounts.getAllByRole('button');
    expect(rows.map((b) => plain(b.textContent))).toEqual([
      'admin Адмін Це ти · активність сьогодні',
      'anna Активність сьогодні · 3 підрахунки сьогодні',
      'olya Вимкнено Ще не входили',
      'new Пароль не задано Ще не входили',
    ]);
    for (const row of rows) expect(row.getAttribute('aria-haspopup')).toBe('dialog');

    // One name for the AI estimates, as on «Акаунт»: «Підрахунки калорій».
    const ai = region('Підрахунки калорій');
    expect(ai.getByText('Ліміти на день')).toBeTruthy();
    expect(ai.getByText('0 — підрахунки вимкнено.')).toBeTruthy();
    expect(ai.getByText('Сьогодні використано 12 з 150.')).toBeTruthy();
    expect(screen.queryByText(/ШІ/)).toBeNull();
  });

  it('keeps the phone’s section titles, and makes them list captions in the desktop pane', async () => {
    const overview = adminOverview({ invites: [adminInvite({ id: '1'.repeat(32), note: 'для Олі' })] });
    await renderPage(overview);
    for (const name of ['Запрошення · 1', 'Акаунти · 3']) {
      const title = region(name).getByRole('heading', { level: 2, name });
      expect(title.className, name).not.toMatch(/paneGroupTitle/);
    }
    cleanup();
    resetAdminOverview();

    mocks.admin.overview.mockResolvedValue(overview);
    render(<UsersPage headingLevel="h3" />);
    await act(settle);
    for (const name of ['Запрошення · 1', 'Акаунти · 3']) {
      const title = region(name).getByRole('heading', { level: 3, name });
      expect(title.className, name).toMatch(/paneGroupTitle/);
    }
  });

  it('hides «Запрошення» while none is pending', async () => {
    await renderPage();
    expect(screen.queryByRole('region', { name: /^Запрошення · / })).toBeNull();
    expect(screen.getByRole('region', { name: 'Акаунти · 3' })).toBeTruthy();
  });

  it('says when the list cannot be loaded, and tries again', async () => {
    mocks.admin.overview.mockRejectedValueOnce(new ApiError(0, 'network', 'x'));
    render(<UsersPage headingLevel="h2" />);
    await act(settle);
    expect(screen.getByRole('alert').textContent).toBe('Не вдалося завантажити');
    mocks.admin.overview.mockResolvedValue(adminOverview());
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    await act(settle);
    expect(screen.getByRole('region', { name: 'Акаунти · 3' })).toBeTruthy();
    expect(mocks.admin.overview).toHaveBeenCalledTimes(2);
  });

  it('needs the internet: «Потрібен інтернет», nothing to tap; back online it loads by itself', async () => {
    useDataStore.setState((st) => ({ sync: { ...st.sync, online: false } }));
    mocks.admin.overview.mockRejectedValueOnce(new ApiError(0, 'network', 'x'));
    render(<UsersPage headingLevel="h2" />);
    await act(settle);
    expect(screen.getByRole('status').textContent).toBe('Потрібен інтернет');
    expect(button(region('Запросити людину'), 'Створити запрошення').disabled).toBe(true);

    mocks.admin.overview.mockResolvedValue(adminOverview());
    setOnline(true);
    await act(settle);
    expect(screen.getByRole('region', { name: 'Акаунти · 3' })).toBeTruthy();
  });

  it('leaves for the list after a 403 and asks the auth layer who is signed in', async () => {
    const { memory } = await renderPage();
    expect(memory.history).toEqual(['/settings/users']);
    // Demoted elsewhere: the next admin call answers 403.
    mocks.admin.createInvite.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    fireEvent.click(button(region('Запросити людину'), 'Створити запрошення'));
    await act(settle);
    expect(mocks.auth.refreshUser).toHaveBeenCalledTimes(1);
    expect(memory.history).toEqual(['/settings']);
  });

  it('leaves at once when the overview itself answers 403', async () => {
    const memory = memoryLocation({ path: '/settings/users', record: true });
    mocks.admin.overview.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    render(
      <Router hook={memory.hook}>
        <Route path="/settings/users">
          <UsersPage headingLevel="h2" />
        </Route>
      </Router>,
    );
    await act(settle);
    expect(mocks.auth.refreshUser).toHaveBeenCalledTimes(1);
    expect(memory.history).toEqual(['/settings']);
  });
});

describe('«Запросити людину» and the link card', () => {
  async function createInvite(note = '') {
    const card = region('Запросити людину');
    const field = card.getByLabelText<HTMLInputElement>('Підпис (для себе)');
    fireEvent.change(field, { target: { value: note } });
    fireEvent.click(button(card, 'Створити запрошення'));
    await act(settle);
  }

  it('has an optional, short note field and explains the link', async () => {
    await renderPage();
    const card = region('Запросити людину');
    const field = card.getByLabelText<HTMLInputElement>('Підпис (для себе)');
    expect(field.placeholder).toBe('Напр., для Олі');
    expect(field.maxLength).toBe(60);
    expect(
      card.getByText('Посилання одноразове й діє 7 днів. Людина сама обере імʼя і пароль.'),
    ).toBeTruthy();
  });

  it('creates an invite and shows the link once, with its expiry; the list reloads', async () => {
    const answer = deferred<InviteCreatedResponse>();
    mocks.admin.createInvite.mockReturnValue(answer.promise);
    await renderPage();
    const card = region('Запросити людину');
    fireEvent.change(card.getByLabelText('Підпис (для себе)'), { target: { value: '  для Олі ' } });
    fireEvent.click(button(card, 'Створити запрошення'));
    expect(mocks.admin.createInvite).toHaveBeenCalledWith({ note: 'для Олі' });
    expect(button(card, 'Створюю…').disabled).toBe(true);
    await act(async () => {
      answer.resolve(inviteCreated());
      await settle();
    });

    const link = region('Запрошення готове');
    const url = link.getByRole<HTMLInputElement>('textbox', { name: 'Посилання' });
    expect(url.value).toBe(`${window.location.origin}/invite#${TOKEN}`);
    expect(url.readOnly).toBe(true);
    expect(link.getByText('Одноразове, діє до 28 жовтня, 14:05.')).toBeTruthy();
    expect(link.getByText('Посилання видно тільки зараз — надішли його або збережи.')).toBeTruthy();
    // Announced: its title takes the focus.
    expect(document.activeElement).toBe(link.getByRole('heading', { name: 'Запрошення готове' }));
    expect(card.getByLabelText<HTMLInputElement>('Підпис (для себе)').value).toBe('');
    expect(mocks.admin.overview).toHaveBeenCalledTimes(2);

    fireEvent.click(button(link, 'Готово'));
    expect(screen.queryByRole('region', { name: 'Запрошення готове' })).toBeNull();
    expect(document.activeElement).toBe(button(card, 'Створити запрошення'));
  });

  it('says so when there are too many pending invites', async () => {
    mocks.admin.createInvite.mockRejectedValue(new ApiError(409, 'limit_reached', 'x'));
    await renderPage();
    await createInvite();
    expect(region('Запросити людину').getByRole('alert').textContent).toBe(
      'Забагато активних запрошень — скасуй старі',
    );
    expect(screen.queryByRole('region', { name: 'Запрошення готове' })).toBeNull();
  });

  it('gives the focus back to «Створити запрошення» after a refusal (it was disabled meanwhile)', async () => {
    const answer = deferred<InviteCreatedResponse>();
    mocks.admin.createInvite.mockReturnValue(answer.promise);
    await renderPage();
    press(button(region('Запросити людину'), 'Створити запрошення'));
    expect(button(region('Запросити людину'), 'Створюю…').disabled).toBe(true);
    dropFocus();
    await act(async () => {
      answer.reject(new ApiError(409, 'limit_reached', 'x'));
      await settle();
    });
    expect(document.activeElement).toBe(button(region('Запросити людину'), 'Створити запрошення'));
  });

  it('says «Скопійовано» only after the clipboard took the link', async () => {
    const written = deferred<void>();
    setClipboard(() => written.promise);
    mocks.admin.createInvite.mockResolvedValue(inviteCreated());
    await renderPage();
    await createInvite();
    fireEvent.click(button(region('Запрошення готове'), 'Скопіювати'));
    expect(clipboard?.writeText).toHaveBeenCalledWith(`${window.location.origin}/invite#${TOKEN}`);
    await act(settle);
    expect(toast()).toBeUndefined();
    await act(async () => {
      written.resolve();
      await settle();
    });
    expect(toast()).toBe('Скопійовано');
  });

  it('selects the link for a manual copy when the clipboard refuses or is missing', async () => {
    mocks.admin.createInvite.mockResolvedValue(inviteCreated());
    for (const refuse of [true, false]) {
      setClipboard(refuse ? () => Promise.reject(new DOMException('denied', 'NotAllowedError')) : undefined);
      useUiStore.setState({ toast: null });
      await renderPage();
      await createInvite();
      const link = region('Запрошення готове');
      fireEvent.click(button(link, 'Скопіювати'));
      await act(settle);
      const url = link.getByRole<HTMLInputElement>('textbox', { name: 'Посилання' });
      expect(toast(), String(refuse)).toBe('Посилання виділено — скопіюй його вручну');
      expect(document.activeElement).toBe(url);
      expect([url.selectionStart, url.selectionEnd]).toEqual([0, url.value.length]);
      cleanup();
      resetAdminOverview();
    }
  });

  it('offers «Поділитися» only where the browser can share, with a self-explaining text', async () => {
    mocks.admin.createInvite.mockResolvedValue(inviteCreated());
    await renderPage();
    await createInvite();
    expect(region('Запрошення готове').queryByRole('button', { name: 'Поділитися' })).toBeNull();
    cleanup();
    resetAdminOverview();

    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue();
    setShare(share);
    await renderPage();
    await createInvite();
    fireEvent.click(button(region('Запрошення готове'), 'Поділитися'));
    await act(settle);
    expect(share).toHaveBeenCalledWith({
      title: 'Запрошення в Легко',
      text: 'Запрошую в Легко — трекер схуднення. Посилання одноразове, діє до 28 жовтня.',
      url: `${window.location.origin}/invite#${TOKEN}`,
    });
    expect(toast()).toBeUndefined();

    // Closing the share sheet is no error; a failing share falls back to the manual copy.
    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    fireEvent.click(button(region('Запрошення готове'), 'Поділитися'));
    await act(settle);
    expect(toast()).toBeUndefined();
    share.mockRejectedValueOnce(new Error('no target'));
    fireEvent.click(button(region('Запрошення готове'), 'Поділитися'));
    await act(settle);
    expect(toast()).toBe('Посилання виділено — скопіюй його вручну');
  });
});

describe('pending invites', () => {
  const overview = () => adminOverview({ invites: [adminInvite({ id: '1'.repeat(32), note: 'для Олі' })] });

  it('revokes one after the in-app confirm, then reloads', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderPage(overview());
    fireEvent.click(region('Запрошення · 1').getByRole('button', { name: 'Скасувати запрошення «для Олі»' }));
    await act(settle);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Скасувати запрошення?',
      body: 'Посилання перестане працювати.',
      confirmLabel: 'Скасувати запрошення',
      cancelLabel: 'Залишити',
      destructive: true,
    });
    expect(mocks.admin.revokeInvite).toHaveBeenCalledWith({ id: '1'.repeat(32) });
    expect(toast()).toBe('Запрошення скасовано');
    expect(mocks.admin.overview).toHaveBeenCalledTimes(2);
  });

  it('keeps it on «Залишити», and explains a link that is already gone', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    await renderPage(overview());
    const revoke = () =>
      fireEvent.click(
        region('Запрошення · 1').getByRole('button', { name: 'Скасувати запрошення «для Олі»' }),
      );
    revoke();
    await act(settle);
    expect(mocks.admin.revokeInvite).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    mocks.admin.revokeInvite.mockRejectedValue(new ApiError(404, 'not_found', 'x'));
    revoke();
    await act(settle);
    expect(toast()).toBe('Це запрошення вже використали або скасували');
  });

  describe('keeps the place: the focus never drops to <body>', () => {
    const [ola, taras, iia] = ['для Олі', 'для Тараса', 'для Ії'].map((note, i) =>
      adminInvite({ id: String(i + 1).repeat(32), note }),
    ) as [AdminInvite, AdminInvite, AdminInvite];
    const revokeButton = (note: string) =>
      region(/^Запрошення · /).getByRole<HTMLButtonElement>('button', {
        name: `Скасувати запрошення «${note}»`,
      });

    it('moves to the next invite’s «Скасувати» after a revoke, to the previous one after the last', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(true);
      await renderPage(adminOverview({ invites: [ola, taras, iia] }));
      // The reload no longer has the revoked one.
      mocks.admin.overview.mockResolvedValue(adminOverview({ invites: [ola, iia] }));
      press(revokeButton('для Тараса'));
      await act(settle);
      expect(region('Запрошення · 2')).toBeTruthy();
      expect(document.activeElement).toBe(revokeButton('для Ії'));

      mocks.admin.overview.mockResolvedValue(adminOverview({ invites: [ola] }));
      press(revokeButton('для Ії'));
      await act(settle);
      expect(document.activeElement).toBe(revokeButton('для Олі'));
    });

    it('moves to «Акаунти · N» when the last pending invite is gone (its whole list is)', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(true);
      await renderPage(adminOverview({ invites: [ola] }));
      mocks.admin.overview.mockResolvedValue(adminOverview());
      press(revokeButton('для Олі'));
      await act(settle);
      expect(screen.queryByRole('region', { name: /^Запрошення · / })).toBeNull();
      const accounts = screen.getByRole('heading', { name: 'Акаунти · 3' });
      expect(document.activeElement).toBe(accounts);
      // Focusable for scripts only, never a Tab stop.
      expect(accounts.getAttribute('tabindex')).toBe('-1');
    });

    it('stays on the same «Скасувати» when the revoke fails and the invite is still there', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(true);
      const answer = deferred<OkResponse>();
      mocks.admin.revokeInvite.mockReturnValue(answer.promise);
      await renderPage(adminOverview({ invites: [ola, taras] }));
      press(revokeButton('для Тараса'));
      await act(settle);
      expect(revokeButton('для Тараса').disabled).toBe(true);
      dropFocus();
      await act(async () => {
        answer.reject(new ApiError(0, 'network', 'x'));
        await settle();
      });
      expect(document.activeElement).toBe(revokeButton('для Тараса'));
    });

    it('leaves the focus alone on «Залишити» (the confirm gives it back itself)', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(false);
      await renderPage(adminOverview({ invites: [ola] }));
      const field = region('Запросити людину').getByLabelText<HTMLInputElement>('Підпис (для себе)');
      fireEvent.click(revokeButton('для Олі'));
      field.focus();
      await act(settle);
      expect(document.activeElement).toBe(field);
    });
  });
});

describe('the user sheet', () => {
  const now = Date.now();
  const overview = (patch: Parameters<typeof adminUser>[1] = {}) =>
    adminOverview({
      users: [
        adminUser('admin', { role: 'admin', self: true, lastSeenAt: now }),
        adminUser('anna', {
          lastSeenAt: now,
          ai: { today: 3, last30Days: 41, limit: 40, customLimit: null },
          ...patch,
        }),
      ],
    });

  it('opens on a row: heading = name, the facts, no records', async () => {
    await renderPage(overview());
    const s = await openSheet('anna');
    expect(s.getByText('Користувач · з 9 жовтня 2026')).toBeTruthy();
    expect(s.getByText(/^Активність: сьогодні, \d\d:\d\d$/)).toBeTruthy();
    expect(s.getByText('Підрахунки: сьогодні 3 · за 30 днів 41')).toBeTruthy();
    const role = s.getByRole('radiogroup', { name: 'Роль' });
    expect(within(role).getByRole('radio', { name: 'Користувач' }).getAttribute('aria-checked')).toBe('true');
    expect(s.getByRole('button', { name: 'Посилання для нового пароля' })).toBeTruthy();
    expect(s.getByRole('button', { name: 'Вимкнути акаунт' })).toBeTruthy();
    expect(s.getByRole('button', { name: 'Видалити акаунт…' })).toBeTruthy();
  });

  it('makes an admin after the honest confirm', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderPage(overview());
    const s = await openSheet('anna');
    fireEvent.click(s.getByRole('radio', { name: 'Адміністратор' }));
    await act(settle);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Зробити anna адміністратором?',
      body:
        'Адміністратор бачить список акаунтів і може запрошувати, вимикати й видаляти їх. Чужих записів ' +
        'адміністратор не бачить. Він може видати посилання для нового пароля — людина про це дізнається.',
      confirmLabel: 'Зробити адміністратором',
    });
    expect(mocks.admin.setRole).toHaveBeenCalledWith({ userId: idOf('anna'), role: 'admin' });
    expect(toast()).toBe('Роль змінено');
    expect(mocks.admin.overview).toHaveBeenCalledTimes(2);
  });

  it('takes admin rights away after its confirm; nothing on cancel', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    await renderPage(
      adminOverview({
        users: [adminUser('admin', { role: 'admin', self: true }), adminUser('boss', { role: 'admin' })],
      }),
    );
    const s = await openSheet('boss');
    fireEvent.click(s.getByRole('radio', { name: 'Користувач' }));
    await act(settle);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Забрати права адміністратора в boss?',
      body: 'Розділ «Користувачі» зникне для цього акаунта.',
      confirmLabel: 'Забрати права',
      destructive: true,
    });
    expect(mocks.admin.setRole).not.toHaveBeenCalled();
  });

  it('lets an admin step down while another one exists, then re-checks the account', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderPage(
      adminOverview({
        users: [adminUser('admin', { role: 'admin', self: true }), adminUser('boss', { role: 'admin' })],
      }),
    );
    const s = await openSheet('admin');
    // Yourself: no disable, no delete.
    expect(s.queryByRole('button', { name: 'Вимкнути акаунт' })).toBeNull();
    expect(s.queryByRole('button', { name: 'Видалити акаунт…' })).toBeNull();
    fireEvent.click(s.getByRole('radio', { name: 'Користувач' }));
    await act(settle);
    expect(confirm.mock.calls[0]?.[0].title).toBe('Забрати права адміністратора в себе?');
    expect(mocks.admin.setRole).toHaveBeenCalledWith({ userId: idOf('admin'), role: 'user' });
    expect(mocks.auth.refreshUser).toHaveBeenCalledTimes(1);
  });

  it('locks the role of the only usable admin, saying why', async () => {
    const confirm = vi.spyOn(ui, 'confirm');
    await renderPage(
      adminOverview({
        users: [
          adminUser('admin', { role: 'admin', self: true }),
          // Neither of these can take over: disabled, no password yet.
          adminUser('boss', { role: 'admin', status: 'disabled' }),
          adminUser('new', { role: 'admin', status: 'pending' }),
        ],
      }),
    );
    const s = await openSheet('admin');
    const radios = within(s.getByRole('radiogroup', { name: 'Роль' })).getAllByRole('radio');
    for (const radio of radios) expect(radio.matches(':disabled')).toBe(true);
    expect(s.getByText('Єдиний адміністратор — спершу признач іншого')).toBeTruthy();
    fireEvent.click(s.getByRole('radio', { name: 'Користувач' }));
    await act(settle);
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.admin.setRole).not.toHaveBeenCalled();
  });

  it('shows the server’s last-admin and self-action refusals', async () => {
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderPage(
      adminOverview({
        users: [adminUser('admin', { role: 'admin', self: true }), adminUser('boss', { role: 'admin' })],
      }),
    );
    let s = await openSheet('boss');
    mocks.admin.setRole.mockRejectedValueOnce(new ApiError(409, 'last_admin', 'x'));
    fireEvent.click(s.getByRole('radio', { name: 'Користувач' }));
    await act(settle);
    expect(s.getByRole('alert').textContent).toBe('Це єдиний адміністратор');

    mocks.admin.setDisabled.mockRejectedValueOnce(new ApiError(409, 'self_action', 'x'));
    fireEvent.click(s.getByRole('button', { name: 'Вимкнути акаунт' }));
    await act(settle);
    s = sheet('boss');
    expect(s.getByRole('alert').textContent).toBe('Із власним акаунтом так не можна');
  });

  it('sets and clears an own AI limit; 0 turns AI off for that account', async () => {
    await renderPage(overview());
    const s = await openSheet('anna');
    const toggle = s.getByRole('switch', { name: 'Окремий ліміт підрахунків' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(s.getByText('Як у всіх: 40 на день')).toBeTruthy();
    expect(s.queryByRole('button', { name: 'Зберегти ліміт' })).toBeNull();

    fireEvent.click(toggle);
    const stepper = s.getByRole('group', { name: 'Ліміт на день' });
    fireEvent.click(within(stepper).getByRole('button', { name: 'Збільшити ліміт' }));
    expect(within(stepper).getByText('45')).toBeTruthy();
    fireEvent.click(s.getByRole('button', { name: 'Зберегти ліміт' }));
    await act(settle);
    expect(mocks.admin.setUserAiLimit).toHaveBeenCalledWith({ userId: idOf('anna'), limit: 45 });
    expect(toast()).toBe('Збережено');

    for (let i = 0; i < 9; i++)
      fireEvent.click(within(stepper).getByRole('button', { name: 'Зменшити ліміт' }));
    expect(within(stepper).getByText('0')).toBeTruthy();
    expect(s.getByText('Для цього акаунта підрахунки вимкнено')).toBeTruthy();
    expect(within(stepper).getByRole<HTMLButtonElement>('button', { name: 'Зменшити ліміт' }).disabled).toBe(
      true,
    );
  });

  it('goes back to the default limit when the switch is turned off', async () => {
    await renderPage(overview({ ai: { today: 0, last30Days: 0, limit: 10, customLimit: 10 } }));
    const s = await openSheet('anna');
    const toggle = s.getByRole('switch', { name: 'Окремий ліміт підрахунків' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    fireEvent.click(s.getByRole('button', { name: 'Зберегти ліміт' }));
    await act(settle);
    expect(mocks.admin.setUserAiLimit).toHaveBeenCalledWith({ userId: idOf('anna'), limit: null });
  });

  it('makes a reset link and shows it in the sheet with its 24-hour note', async () => {
    mocks.admin.resetLink.mockResolvedValue({
      ok: true,
      path: `/reset#${TOKEN}`,
      expiresAt: Date.now() + 86_400_000,
    });
    await renderPage(overview());
    const s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Посилання для нового пароля' }));
    await act(settle);
    expect(mocks.admin.resetLink).toHaveBeenCalledWith({ userId: idOf('anna') });
    const link = within(s.getByRole('region', { name: 'Посилання готове' }));
    expect(link.getByRole<HTMLInputElement>('textbox', { name: 'Посилання' }).value).toBe(
      `${window.location.origin}/reset#${TOKEN}`,
    );
    expect(
      link.getByText('Одноразове, діє 24 години. Старий пароль працює, доки посиланням не скористаються.'),
    ).toBeTruthy();
    expect(link.getByRole('heading', { level: 3, name: 'Посилання готове' })).toBeTruthy();

    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue();
    setShare(share);
    cleanup();
    resetAdminOverview();
    await renderPage(overview());
    const again = await openSheet('anna');
    fireEvent.click(again.getByRole('button', { name: 'Посилання для нового пароля' }));
    await act(settle);
    fireEvent.click(again.getByRole('button', { name: 'Поділитися' }));
    await act(settle);
    expect(share).toHaveBeenCalledWith({
      title: 'Новий пароль у Легко',
      text: 'Посилання для нового пароля в Легко, діє 24 години.',
      url: `${window.location.origin}/reset#${TOKEN}`,
    });
  });

  it('calls it «Посилання для пароля» for an account without one', async () => {
    mocks.admin.resetLink.mockResolvedValue({ ok: true, path: `/reset#${TOKEN}`, expiresAt: Date.now() });
    await renderPage(overview({ status: 'pending' }));
    const s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Посилання для пароля' }));
    await act(settle);
    expect(s.getByText('Одноразове, діє 24 години.')).toBeTruthy();
  });

  it('hides the reset link for a disabled account, and maps the server’s account_disabled', async () => {
    await renderPage(overview({ status: 'disabled' }));
    let s = await openSheet('anna');
    expect(s.queryByRole('button', { name: /^Посилання для/ })).toBeNull();
    expect(s.getByText('Щоб надіслати посилання, спершу ввімкни акаунт.')).toBeTruthy();
    cleanup();
    resetAdminOverview();

    // Disabled elsewhere in the meantime.
    mocks.admin.resetLink.mockRejectedValue(new ApiError(409, 'account_disabled', 'x'));
    await renderPage(overview());
    s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Посилання для нового пароля' }));
    await act(settle);
    expect(s.getByRole('alert').textContent).toBe('Акаунт вимкнено — спершу ввімкни його');
  });

  it('disables after the confirm and enables without one', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await renderPage(overview());
    const s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Вимкнути акаунт' }));
    await act(settle);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Вимкнути акаунт anna?',
      body:
        'Увійти в нього буде неможливо, усі його пристрої вийдуть з акаунта, нагадування зупиняться. Записи ' +
        'збережуться — акаунт можна знову ввімкнути.',
      confirmLabel: 'Вимкнути',
      destructive: true,
    });
    expect(mocks.admin.setDisabled).toHaveBeenCalledWith({ userId: idOf('anna'), disabled: true });
    expect(toast()).toBe('Акаунт вимкнено');
    cleanup();
    resetAdminOverview();
    confirm.mockClear();

    await renderPage(overview({ status: 'disabled' }));
    const d = await openSheet('anna');
    fireEvent.click(d.getByRole('button', { name: 'Увімкнути акаунт' }));
    await act(settle);
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.admin.setDisabled).toHaveBeenLastCalledWith({ userId: idOf('anna'), disabled: false });
    expect(toast()).toBe('Акаунт увімкнено');
  });

  it('deletes only after the name is typed (any case); Escape goes back to the details first', async () => {
    await renderPage(overview());
    let s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Видалити акаунт…' }));
    s = sheet('anna');
    expect(s.getByRole('heading', { name: 'Видалити акаунт anna?' })).toBeTruthy();
    expect(
      s.getByText(
        'Буде видалено всі записи цього акаунта — дні, прийоми їжі, фото, вагу, заміри, налаштування. ' +
          'Відновити їх буде неможливо.',
      ),
    ).toBeTruthy();
    const typed = s.getByRole<HTMLInputElement>('textbox', { name: 'Імʼя для підтвердження' });
    expect(document.activeElement).toBe(typed);
    expect(typed.getAttribute('autocapitalize')).toBe('none');
    expect(typed.getAttribute('autocomplete')).toBe('off');
    expect(typed.getAttribute('autocorrect')).toBe('off');
    expect(typed.getAttribute('spellcheck')).toBe('false');
    expect(typed.getAttribute('aria-describedby')).toBe(s.getByText('Щоб підтвердити, введи імʼя: anna').id);
    const remove = s.getByRole<HTMLButtonElement>('button', { name: 'Видалити назавжди' });
    expect(remove.disabled).toBe(true);
    fireEvent.change(typed, { target: { value: 'ann' } });
    expect(remove.disabled).toBe(true);

    // Escape: back to the details, the sheet stays open.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(settle);
    expect(screen.getByRole('dialog', { name: 'anna' })).toBeTruthy();
    expect(sheet('anna').queryByRole('textbox', { name: 'Імʼя для підтвердження' })).toBeNull();
    expect(document.activeElement).toBe(sheet('anna').getByRole('button', { name: 'Видалити акаунт…' }));

    fireEvent.click(sheet('anna').getByRole('button', { name: 'Видалити акаунт…' }));
    s = sheet('anna');
    fireEvent.change(s.getByRole('textbox', { name: 'Імʼя для підтвердження' }), {
      target: { value: ' ANNA ' },
    });
    expect(s.getByRole<HTMLButtonElement>('button', { name: 'Видалити назавжди' }).disabled).toBe(false);
    fireEvent.click(s.getByRole('button', { name: 'Видалити назавжди' }));
    await act(settle);
    expect(mocks.admin.deleteUser).toHaveBeenCalledWith({ userId: idOf('anna'), confirmUsername: 'ANNA' });
    expect(toast()).toBe('Акаунт anna видалено');
    expect(mocks.admin.overview).toHaveBeenCalledTimes(2);
  });

  it('«Скасувати» in the delete panel goes back; a mismatch from the server is explained', async () => {
    mocks.admin.deleteUser.mockRejectedValue(new ApiError(400, 'bad_request', 'x'));
    await renderPage(overview());
    let s = await openSheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Видалити акаунт…' }));
    s = sheet('anna');
    fireEvent.click(s.getByRole('button', { name: 'Скасувати' }));
    expect(sheet('anna').getByRole('button', { name: 'Вимкнути акаунт' })).toBeTruthy();

    fireEvent.click(sheet('anna').getByRole('button', { name: 'Видалити акаунт…' }));
    s = sheet('anna');
    fireEvent.change(s.getByRole('textbox', { name: 'Імʼя для підтвердження' }), {
      target: { value: 'anna' },
    });
    fireEvent.click(s.getByRole('button', { name: 'Видалити назавжди' }));
    await act(settle);
    expect(sheet('anna').getByRole('alert').textContent).toBe('Імʼя для підтвердження не збігається');
  });

  it('needs the internet for every action', async () => {
    await renderPage(overview());
    const s = await openSheet('anna');
    setOnline(false);
    for (const name of ['Посилання для нового пароля', 'Вимкнути акаунт', 'Видалити акаунт…']) {
      expect(s.getByRole<HTMLButtonElement>('button', { name }).disabled, name).toBe(true);
    }
    for (const radio of s.getAllByRole('radio')) expect(radio.matches(':disabled')).toBe(true);
    expect(s.getByText('Потрібен інтернет')).toBeTruthy();
  });

  describe('keeps the place: the focus never drops to <body>', () => {
    it('moves to «Акаунти · N» after a delete (the row that opened the sheet is gone)', async () => {
      await renderPage(overview());
      let s = await openSheet('anna');
      fireEvent.click(s.getByRole('button', { name: 'Видалити акаунт…' }));
      s = sheet('anna');
      fireEvent.change(s.getByRole('textbox', { name: 'Імʼя для підтвердження' }), {
        target: { value: 'anna' },
      });
      mocks.admin.overview.mockResolvedValue(
        adminOverview({ users: [adminUser('admin', { role: 'admin', self: true, lastSeenAt: now })] }),
      );
      press(s.getByRole('button', { name: 'Видалити назавжди' }));
      await act(settle);
      expect(toast()).toBe('Акаунт anna видалено');
      expect(region('Акаунти · 1').queryByRole('button', { name: /^anna/ })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Акаунти · 1' }));
    });

    it('stays in the delete panel when the delete is refused', async () => {
      const answer = deferred<OkResponse>();
      mocks.admin.deleteUser.mockReturnValue(answer.promise);
      await renderPage(overview());
      let s = await openSheet('anna');
      fireEvent.click(s.getByRole('button', { name: 'Видалити акаунт…' }));
      s = sheet('anna');
      fireEvent.change(s.getByRole('textbox', { name: 'Імʼя для підтвердження' }), {
        target: { value: 'anna' },
      });
      press(s.getByRole('button', { name: 'Видалити назавжди' }));
      dropFocus();
      await act(async () => {
        answer.reject(new ApiError(429, 'rate_limited', 'x'));
        await settle();
      });
      expect(sheet('anna').getByRole('alert').textContent).toBe('Забагато спроб — спробуй за кілька хвилин');
      expect(document.activeElement).toBe(sheet('anna').getByRole('button', { name: 'Видалити назавжди' }));
    });

    it('goes back to «Вимкнути акаунт» — now «Увімкнути акаунт» — once it is enabled again', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(true);
      const answer = deferred<OkResponse>();
      mocks.admin.setDisabled.mockReturnValue(answer.promise);
      await renderPage(overview());
      const s = await openSheet('anna');
      const toggle = s.getByRole<HTMLButtonElement>('button', { name: 'Вимкнути акаунт' });
      press(toggle);
      await act(settle);
      expect(toggle.disabled).toBe(true);
      dropFocus();
      mocks.admin.overview.mockResolvedValue(overview({ status: 'disabled' }));
      await act(async () => {
        answer.resolve(OK);
        await settle();
      });
      expect(document.activeElement).toBe(sheet('anna').getByRole('button', { name: 'Увімкнути акаунт' }));
    });

    it('goes back to the role radio after a role change', async () => {
      vi.spyOn(ui, 'confirm').mockResolvedValue(true);
      const answer = deferred<OkResponse>();
      mocks.admin.setRole.mockReturnValue(answer.promise);
      await renderPage(overview());
      const s = await openSheet('anna');
      press(s.getByRole('radio', { name: 'Адміністратор' }));
      await act(settle);
      dropFocus();
      mocks.admin.overview.mockResolvedValue(overview({ role: 'admin' }));
      await act(async () => {
        answer.resolve(OK);
        await settle();
      });
      const radio = sheet('anna').getByRole('radio', { name: 'Адміністратор' });
      expect(radio.getAttribute('aria-checked')).toBe('true');
      expect(document.activeElement).toBe(radio);
    });

    it('moves to the switch once «Зберегти ліміт» is gone after saving', async () => {
      const answer = deferred<OkResponse>();
      mocks.admin.setUserAiLimit.mockReturnValue(answer.promise);
      await renderPage(overview());
      const s = await openSheet('anna');
      fireEvent.click(s.getByRole('switch', { name: 'Окремий ліміт підрахунків' }));
      press(s.getByRole('button', { name: 'Зберегти ліміт' }));
      dropFocus();
      mocks.admin.overview.mockResolvedValue(
        overview({ ai: { today: 3, last30Days: 41, limit: 40, customLimit: 40 } }),
      );
      await act(async () => {
        answer.resolve(OK);
        await settle();
      });
      expect(mocks.admin.setUserAiLimit).toHaveBeenCalledWith({ userId: idOf('anna'), limit: 40 });
      expect(sheet('anna').queryByRole('button', { name: 'Зберегти ліміт' })).toBeNull();
      expect(document.activeElement).toBe(
        sheet('anna').getByRole('switch', { name: 'Окремий ліміт підрахунків' }),
      );
    });
  });
});

describe('«Підрахунки калорій»', () => {
  it('shows short labels on the steppers (the subtitle says «на день»), named in full', async () => {
    await renderPage();
    const card = region('Підрахунки калорій');
    expect(card.getByRole('heading', { name: 'Підрахунки калорій' })).toBeTruthy();
    expect(card.getByText('Ліміти на день')).toBeTruthy();
    expect(card.getByText('На людину')).toBeTruthy();
    expect(card.getByText('Усього')).toBeTruthy();
    // The names start with the visible label (WCAG 2.5.3).
    for (const [label, name] of [
      ['На людину', 'На людину за день'],
      ['Усього', 'Усього за день'],
    ] as const) {
      expect(card.getByRole('group', { name }).getAttribute('aria-label')?.startsWith(label)).toBe(true);
    }
  });

  it('puts the focus on the card title after a save (the button stays disabled), on the button after a refusal', async () => {
    const answer = deferred<OkResponse>();
    mocks.admin.setAiLimits.mockReturnValue(answer.promise);
    await renderPage();
    const card = region('Підрахунки калорій');
    const perUser = within(card.getByRole('group', { name: 'На людину за день' }));
    fireEvent.click(perUser.getByRole('button', { name: 'Збільшити ліміт на людину' }));
    press(button(card, 'Зберегти ліміти'));
    dropFocus();
    await act(async () => {
      answer.reject(new ApiError(0, 'network', 'x'));
      await settle();
    });
    expect(card.getByRole('alert').textContent).toBe('Немає зʼєднання з сервером');
    expect(document.activeElement).toBe(button(card, 'Зберегти ліміти'));

    mocks.admin.setAiLimits.mockResolvedValue(OK);
    mocks.admin.overview.mockResolvedValue(adminOverview({ limits: { perUser: 45, global: 150 } }));
    press(button(card, 'Зберегти ліміти'));
    await act(settle);
    expect(button(card, 'Зберегти ліміти').disabled).toBe(true);
    const title = card.getByRole('heading', { name: 'Підрахунки калорій' });
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('does not pull the focus away from where the person went meanwhile', async () => {
    const answer = deferred<OkResponse>();
    mocks.admin.setAiLimits.mockReturnValue(answer.promise);
    await renderPage();
    const card = region('Підрахунки калорій');
    fireEvent.click(
      within(card.getByRole('group', { name: 'На людину за день' })).getByRole('button', {
        name: 'Збільшити ліміт на людину',
      }),
    );
    press(button(card, 'Зберегти ліміти'));
    const note = region('Запросити людину').getByLabelText<HTMLInputElement>('Підпис (для себе)');
    note.focus();
    mocks.admin.overview.mockResolvedValue(adminOverview({ limits: { perUser: 45, global: 150 } }));
    await act(async () => {
      answer.resolve(OK);
      await settle();
    });
    expect(document.activeElement).toBe(note);
  });

  it('saves the limits only once they changed', async () => {
    await renderPage();
    const card = region('Підрахунки калорій');
    const save = button(card, 'Зберегти ліміти');
    expect(save.disabled).toBe(true);
    const perUser = within(card.getByRole('group', { name: 'На людину за день' }));
    const global = within(card.getByRole('group', { name: 'Усього за день' }));
    expect(perUser.getByText('40')).toBeTruthy();
    expect(global.getByText('150')).toBeTruthy();
    fireEvent.click(perUser.getByRole('button', { name: 'Збільшити ліміт на людину' }));
    fireEvent.click(global.getByRole('button', { name: 'Зменшити ліміт на всіх' }));
    expect(perUser.getByText('45')).toBeTruthy();
    expect(global.getByText('140')).toBeTruthy();
    expect(save.disabled).toBe(false);
    // Back to the saved value: nothing to save.
    fireEvent.click(perUser.getByRole('button', { name: 'Зменшити ліміт на людину' }));
    fireEvent.click(global.getByRole('button', { name: 'Збільшити ліміт на всіх' }));
    expect(save.disabled).toBe(true);

    fireEvent.click(perUser.getByRole('button', { name: 'Збільшити ліміт на людину' }));
    mocks.admin.overview.mockResolvedValue(adminOverview({ limits: { perUser: 45, global: 150 } }));
    fireEvent.click(save);
    await act(settle);
    expect(mocks.admin.setAiLimits).toHaveBeenCalledWith({ perUser: 45, global: 150 });
    expect(toast()).toBe('Збережено');
    expect(button(region('Підрахунки калорій'), 'Зберегти ліміти').disabled).toBe(true);
  });
});
