import type { FoodStatusResponse, MeResponse, OkResponse, SessionUser } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '@/auth/auth';
import { useAuthStore } from '@/auth/auth';
import type * as ApiModule from '@/lib/api';
import { ApiError } from '@/lib/api';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { deferred, sampleData, sessionUser, settle } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { installMatchMedia } from '@/ui/internal/testing';
import { at } from '../users/testing';
import { AccountPage } from './AccountPage';

const mocks = vi.hoisted(() => ({
  auth: {
    updateUser: vi.fn<(user: SessionUser) => void>(),
    refreshUser: vi.fn<() => Promise<void>>(),
    logout: vi.fn<() => Promise<boolean>>(),
  },
  api: {
    account: {
      changePassword: vi.fn<(req: { currentPassword: string; newPassword: string }) => Promise<OkResponse>>(),
      rename: vi.fn<(req: { username: string; password: string }) => Promise<MeResponse>>(),
    },
    foodStatus: vi.fn<() => Promise<FoodStatusResponse>>(),
  },
}));

vi.mock('@/auth/auth', async (importOriginal) => {
  const real = await importOriginal<typeof AuthModule>();
  return { ...real, authActions: { ...real.authActions, ...mocks.auth } };
});
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const ANNA = sessionUser({ username: 'anna', createdAt: at(2026, 10, 9) });

const toast = () => useUiStore.getState().toast?.text;
const region = (name: string) => within(screen.getByRole('region', { name }));
type Scope = ReturnType<typeof region>;
const passwordCard = () => region('Пароль');
const nameCard = () => region('Імʼя для входу');
const input = (scope: Scope, label: string) =>
  scope.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;
const button = (scope: Scope, name: string) => scope.getByRole('button', { name }) as HTMLButtonElement;
const setOnline = (online: boolean) =>
  act(() => useDataStore.setState((st) => ({ sync: { ...st.sync, online } })));

async function renderPage(user: SessionUser | null = ANNA) {
  useAuthStore.setState({ status: 'authed', offline: false, user });
  const view = render(<AccountPage headingLevel="h2" />);
  await act(settle);
  return view;
}

function fillPassword(current: string, next: string, repeat = next) {
  fireEvent.change(input(passwordCard(), 'Поточний пароль'), { target: { value: current } });
  fireEvent.change(input(passwordCard(), 'Новий пароль'), { target: { value: next } });
  fireEvent.change(input(passwordCard(), 'Повтори новий пароль'), { target: { value: repeat } });
}

const submitPassword = () => fireEvent.click(button(passwordCard(), 'Змінити пароль'));

/** Presses a control the way a browser does: it takes the focus first. */
function press(el: HTMLElement) {
  el.focus();
  fireEvent.click(el);
}

/**
 * What a browser does when the focused control gets disabled while it works: the focus drops to <body>. jsdom keeps
 * it on the disabled control (and ignores `blur()` there), so it is parked on a stand-in that then goes away.
 */
const dropFocus = () =>
  act(() => {
    const standIn = document.createElement('input');
    document.body.append(standIn);
    standIn.focus();
    standIn.remove();
  });

beforeEach(() => {
  installMatchMedia();
  mocks.auth.updateUser.mockReset().mockImplementation((user) => useAuthStore.setState({ user }));
  mocks.auth.refreshUser.mockReset().mockResolvedValue();
  mocks.auth.logout.mockReset().mockResolvedValue(false);
  mocks.api.account.changePassword.mockReset();
  mocks.api.account.rename.mockReset();
  mocks.api.foodStatus.mockReset().mockResolvedValue({ enabled: false, remainingToday: 0 });
  useDataStore.setState({ data: sampleData(), sync: { ...initialSyncState(), loaded: true, online: true } });
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('«Акаунт» — profile and «Вийти»', () => {
  it('shows the avatar letter, the name and «Користувач · з …»', async () => {
    await renderPage();
    const profile = region('Профіль');
    expect(profile.getByText('anna')).toBeTruthy();
    expect(profile.getByText('Користувач · з 9 жовтня 2026')).toBeTruthy();
    expect(profile.getByText('A').getAttribute('aria-hidden')).toBe('true');
  });

  it('tells a user, in one calm line under «з …», that the admin sees their records', async () => {
    await renderPage();
    const profile = screen.getByRole('region', { name: 'Профіль' });
    const line = within(profile).getByText('Адміністратор бачить твої записи та прогрес.');
    expect(line.tagName).toBe('P');
    const since = within(profile).getByText('Користувач · з 9 жовтня 2026');
    expect(since.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing louder: no alert, no dialog.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText(/Адміністратор бачить/)).toHaveLength(1);
  });

  it('says «Адміністратор» for an admin, without the line', async () => {
    await renderPage(sessionUser({ username: 'admin', role: 'admin', createdAt: at(2026, 10, 21) }));
    expect(region('Профіль').getByText('Адміністратор · з 21 жовтня 2026')).toBeTruthy();
    expect(screen.queryByText(/Адміністратор бачить/)).toBeNull();
  });

  it('ends with «Вийти», which logs out with the usual confirm', async () => {
    await renderPage();
    const logout = screen.getByRole('button', { name: 'Вийти' });
    const name = screen.getByRole('region', { name: 'Імʼя для входу' });
    expect(name.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(logout);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    await act(settle);
  });

  it('waits for the account while it is not known, «Вийти» still there', async () => {
    await renderPage(null);
    expect(screen.getByRole('status').textContent).toBe('Завантажую…');
    expect(screen.queryByRole('region', { name: 'Пароль' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Вийти' })).toBeTruthy();
  });
});

describe('«Пароль»', () => {
  it('is a real form with autofill hints and the account name hidden for the Keychain', async () => {
    await renderPage();
    const card = screen.getByRole('region', { name: 'Пароль' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Пароль' })).toBeTruthy();
    const form = card.querySelector('form');
    expect(form).toBeTruthy();
    const hidden = form?.querySelector<HTMLInputElement>('input[name="username"]');
    expect(hidden?.type).toBe('text');
    expect(hidden?.value).toBe('anna');
    expect(hidden?.readOnly).toBe(true);
    expect(hidden?.tabIndex).toBe(-1);
    expect(hidden?.getAttribute('autocomplete')).toBe('username');
    expect(hidden?.getAttribute('aria-hidden')).toBe('true');
    expect(hidden?.classList.contains('visually-hidden')).toBe(true);

    const current = input(passwordCard(), 'Поточний пароль');
    const next = input(passwordCard(), 'Новий пароль');
    const repeat = input(passwordCard(), 'Повтори новий пароль');
    expect([current, next, repeat].map((el) => el.type)).toEqual(['password', 'password', 'password']);
    expect([current, next, repeat].map((el) => el.getAttribute('autocomplete'))).toEqual([
      'current-password',
      'new-password',
      'new-password',
    ]);
    expect(next.getAttribute('aria-describedby')).toBe(passwordCard().getByText('Щонайменше 8 символів').id);
    expect(passwordCard().getByText('Інші пристрої вийдуть з акаунта, цей — ні.')).toBeTruthy();
    expect(button(passwordCard(), 'Змінити пароль').type).toBe('submit');
  });

  it('checks the fields before sending anything', async () => {
    await renderPage();
    submitPassword();
    let alert = passwordCard().getByRole('alert');
    expect(alert.textContent).toBe('Введи поточний пароль');
    expect(document.activeElement).toBe(input(passwordCard(), 'Поточний пароль'));
    expect(input(passwordCard(), 'Поточний пароль').getAttribute('aria-invalid')).toBe('true');
    expect(input(passwordCard(), 'Поточний пароль').getAttribute('aria-describedby')).toBe(alert.id);

    fillPassword('old-password', 'short');
    submitPassword();
    expect(passwordCard().getByRole('alert').textContent).toBe('Новий пароль — щонайменше 8 символів');
    expect(document.activeElement).toBe(input(passwordCard(), 'Новий пароль'));

    fillPassword('old-password', 'new-password-1', 'new-password-2');
    submitPassword();
    alert = passwordCard().getByRole('alert');
    expect(alert.textContent).toBe('Паролі не збігаються');
    expect(document.activeElement).toBe(input(passwordCard(), 'Повтори новий пароль'));
    expect(mocks.api.account.changePassword).not.toHaveBeenCalled();

    // Typing again clears the error.
    fireEvent.change(input(passwordCard(), 'Повтори новий пароль'), { target: { value: 'new-password-1' } });
    expect(passwordCard().queryByRole('alert')).toBeNull();
  });

  it('changes the password: «Змінюю…», then a toast, empty fields and a fresh account', async () => {
    const answer = deferred<OkResponse>();
    mocks.api.account.changePassword.mockReturnValue(answer.promise);
    await renderPage();
    fillPassword('old-password', 'new-password-1');
    submitPassword();
    expect(mocks.api.account.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    });
    expect(button(passwordCard(), 'Змінюю…').disabled).toBe(true);
    // A second tap while it runs sends nothing more.
    fireEvent.submit(
      passwordCard().getByRole('button', { name: 'Змінюю…' }).closest('form') as HTMLFormElement,
    );
    expect(mocks.api.account.changePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve({ ok: true });
      await settle();
    });
    expect(toast()).toBe('Пароль змінено');
    for (const label of ['Поточний пароль', 'Новий пароль', 'Повтори новий пароль']) {
      expect(input(passwordCard(), label).value, label).toBe('');
    }
    expect(button(passwordCard(), 'Змінити пароль').disabled).toBe(false);
    // The provenance line follows the server («Пароль змінено …»).
    expect(mocks.auth.refreshUser).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s refusals in the card', async () => {
    await renderPage();
    const cases: [ApiError, string, string | null][] = [
      [new ApiError(403, 'wrong_password', 'x'), 'Поточний пароль неправильний', 'Поточний пароль'],
      [new ApiError(400, 'weak_password', 'x'), 'Новий пароль — щонайменше 8 символів', 'Новий пароль'],
      [new ApiError(429, 'rate_limited', 'x'), 'Забагато спроб — спробуй за кілька хвилин', null],
      [new ApiError(0, 'network', 'x'), 'Немає зʼєднання з сервером', null],
    ];
    for (const [error, text, field] of cases) {
      mocks.api.account.changePassword.mockRejectedValueOnce(error);
      fillPassword('old-password', 'new-password-1');
      submitPassword();
      await act(settle);
      expect(passwordCard().getByRole('alert').textContent, error.code).toBe(text);
      if (field) expect(document.activeElement, error.code).toBe(input(passwordCard(), field));
      // Nothing is cleared after a refusal.
      expect(input(passwordCard(), 'Новий пароль').value).toBe('new-password-1');
    }
    expect(toast()).toBeUndefined();
  });

  describe('keeps the place: the focus never drops to <body>', () => {
    it('goes back to «Змінити пароль» after a change (it was disabled while it worked)', async () => {
      const answer = deferred<OkResponse>();
      mocks.api.account.changePassword.mockReturnValue(answer.promise);
      await renderPage();
      fillPassword('old-password', 'new-password-1');
      press(button(passwordCard(), 'Змінити пароль'));
      expect(button(passwordCard(), 'Змінюю…').disabled).toBe(true);
      dropFocus();
      await act(async () => {
        answer.resolve({ ok: true });
        await settle();
      });
      expect(toast()).toBe('Пароль змінено');
      expect(document.activeElement).toBe(button(passwordCard(), 'Змінити пароль'));
    });

    it('goes back to «Змінити пароль» after a refusal with no field to point at', async () => {
      for (const error of [new ApiError(429, 'rate_limited', 'x'), new ApiError(0, 'network', 'x')]) {
        const answer = deferred<OkResponse>();
        mocks.api.account.changePassword.mockReturnValue(answer.promise);
        await renderPage();
        fillPassword('old-password', 'new-password-1');
        press(button(passwordCard(), 'Змінити пароль'));
        dropFocus();
        await act(async () => {
          answer.reject(error);
          await settle();
        });
        expect(passwordCard().getByRole('alert')).toBeTruthy();
        expect(document.activeElement, error.code).toBe(button(passwordCard(), 'Змінити пароль'));
        cleanup();
      }
    });

    it('moves to the card title when the button cannot take it back (offline meanwhile)', async () => {
      const answer = deferred<OkResponse>();
      mocks.api.account.changePassword.mockReturnValue(answer.promise);
      await renderPage();
      fillPassword('old-password', 'new-password-1');
      press(button(passwordCard(), 'Змінити пароль'));
      dropFocus();
      setOnline(false);
      await act(async () => {
        answer.resolve({ ok: true });
        await settle();
      });
      expect(button(passwordCard(), 'Змінити пароль').disabled).toBe(true);
      const title = passwordCard().getByRole('heading', { name: 'Пароль' });
      expect(document.activeElement).toBe(title);
      // Focusable for scripts only, never a Tab stop.
      expect(title.getAttribute('tabindex')).toBe('-1');
    });

    it('leaves the focus where the person went meanwhile (Enter in a field keeps it there)', async () => {
      const answer = deferred<OkResponse>();
      mocks.api.account.changePassword.mockReturnValue(answer.promise);
      await renderPage();
      fillPassword('old-password', 'new-password-1');
      const repeat = input(passwordCard(), 'Повтори новий пароль');
      repeat.focus();
      fireEvent.submit(repeat.closest('form') as HTMLFormElement);
      await act(async () => {
        answer.resolve({ ok: true });
        await settle();
      });
      expect(document.activeElement).toBe(repeat);
    });
  });

  it('needs the internet: the button is disabled and says why', async () => {
    await renderPage();
    setOnline(false);
    const submit = button(passwordCard(), 'Змінити пароль');
    expect(submit.disabled).toBe(true);
    const note = passwordCard().getByText('Потрібен інтернет');
    expect(submit.getAttribute('aria-describedby')).toBe(note.id);
    fillPassword('old-password', 'new-password-1');
    fireEvent.submit(submit.closest('form') as HTMLFormElement);
    expect(mocks.api.account.changePassword).not.toHaveBeenCalled();
    setOnline(true);
    expect(button(passwordCard(), 'Змінити пароль').disabled).toBe(false);
    expect(passwordCard().queryByText('Потрібен інтернет')).toBeNull();
  });

  it('says where the password came from (D28)', async () => {
    const day = at(new Date().getFullYear(), 10, 21, 9, 0);
    const cases: [SessionUser['passwordChange'], string | null][] = [
      [null, null],
      [{ at: day, via: 'self', by: null }, 'Пароль змінено 21 жовтня.'],
      [{ at: day, via: 'reset', by: 'admin' }, 'Пароль задано 21 жовтня за посиланням від admin.'],
      [{ at: day, via: 'setup', by: null }, 'Пароль задано 21 жовтня за посиланням з консолі.'],
      [{ at: day, via: 'cli', by: null }, 'Пароль задано 21 жовтня на сервері.'],
    ];
    for (const [passwordChange, line] of cases) {
      await renderPage({ ...ANNA, passwordChange });
      const text = passwordCard().queryByText(/^Пароль (змінено|задано)/)?.textContent ?? null;
      expect(text, String(passwordChange?.via)).toBe(line);
      cleanup();
    }
  });
});

describe('«Імʼя для входу»', () => {
  const openRename = () => fireEvent.click(button(nameCard(), 'Змінити'));
  const renameTo = (name: string, password: string) => {
    fireEvent.change(input(nameCard(), 'Нове імʼя'), { target: { value: name } });
    fireEvent.change(input(nameCard(), 'Пароль'), { target: { value: password } });
    fireEvent.click(button(nameCard(), 'Зберегти імʼя'));
  };

  it('opens a form under the name with the autofill hints and the name rule', async () => {
    await renderPage();
    const toggle = button(nameCard(), 'Змінити');
    expect(nameCard().getByText('anna')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(nameCard().queryByLabelText('Нове імʼя')).toBeNull();

    openRename();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const form = nameCard().getByRole('textbox', { name: 'Нове імʼя' }).closest('form');
    expect(toggle.getAttribute('aria-controls')).toBe(form?.id);
    const name = input(nameCard(), 'Нове імʼя');
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('anna');
    expect(name.getAttribute('autocomplete')).toBe('username');
    expect(name.getAttribute('autocapitalize')).toBe('none');
    expect(name.getAttribute('autocorrect')).toBe('off');
    expect(name.getAttribute('spellcheck')).toBe('false');
    // getByText normalises the no-break spaces of the rule text to plain spaces; textContent keeps them.
    const hint = nameCard().getByText(
      '3–32 символи: латинські літери, цифри, крапка (.), дефіс (-) або підкреслення (_)',
    );
    expect(hint.textContent).toBe(
      '3–32 символи: латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
    );
    expect(name.getAttribute('aria-describedby')).toBe(hint.id);
    const password = input(nameCard(), 'Пароль');
    expect(password.type).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(nameCard().getByText('Після зміни входь з новим імʼям.')).toBeTruthy();
  });

  it('renames: the new name everywhere (pointer, list row), a toast, the form closed', async () => {
    const renamed = { ...ANNA, username: 'anna.k' };
    mocks.api.account.rename.mockResolvedValue({ ok: true, user: renamed });
    await renderPage();
    openRename();
    renameTo('  anna.k ', 'my-password');
    await act(settle);
    expect(mocks.api.account.rename).toHaveBeenCalledWith({ username: 'anna.k', password: 'my-password' });
    expect(mocks.auth.updateUser).toHaveBeenCalledWith(renamed);
    expect(toast()).toBe('Імʼя змінено');
    expect(nameCard().queryByLabelText('Нове імʼя')).toBeNull();
    expect(nameCard().getByText('anna.k')).toBeTruthy();
    expect(region('Профіль').getByText('anna.k')).toBeTruthy();
    expect(document.activeElement).toBe(button(nameCard(), 'Змінити'));
  });

  it('refuses a bad or reserved name and a missing password without asking the server', async () => {
    await renderPage();
    openRename();
    renameTo('an', 'pw');
    expect(nameCard().getByRole('alert').textContent).toBe(
      'Імʼя: 3–32 символи — латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
    );
    expect(input(nameCard(), 'Нове імʼя').getAttribute('aria-invalid')).toBe('true');
    renameTo('admin', 'pw');
    expect(nameCard().getByRole('alert').textContent).toBe('Це імʼя зарезервоване — обери інше');
    renameTo('anna.k', '');
    expect(nameCard().getByRole('alert').textContent).toBe('Введи пароль');
    expect(document.activeElement).toBe(input(nameCard(), 'Пароль'));
    expect(mocks.api.account.rename).not.toHaveBeenCalled();
  });

  it('maps the server’s answers: a taken name, a wrong password', async () => {
    await renderPage();
    openRename();
    mocks.api.account.rename.mockRejectedValueOnce(new ApiError(409, 'username_taken', 'x'));
    renameTo('olya', 'my-password');
    await act(settle);
    expect(nameCard().getByRole('alert').textContent).toBe('Це імʼя вже зайняте');
    expect(document.activeElement).toBe(input(nameCard(), 'Нове імʼя'));

    mocks.api.account.rename.mockRejectedValueOnce(new ApiError(403, 'wrong_password', 'x'));
    renameTo('anna.k', 'wrong');
    await act(settle);
    expect(nameCard().getByRole('alert').textContent).toBe('Пароль неправильний');
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it('gives the focus back to «Зберегти імʼя» after a refusal with no field to point at', async () => {
    const answer = deferred<MeResponse>();
    mocks.api.account.rename.mockReturnValue(answer.promise);
    await renderPage();
    openRename();
    fireEvent.change(input(nameCard(), 'Нове імʼя'), { target: { value: 'anna.k' } });
    fireEvent.change(input(nameCard(), 'Пароль'), { target: { value: 'my-password' } });
    press(button(nameCard(), 'Зберегти імʼя'));
    expect(button(nameCard(), 'Зберігаю…').disabled).toBe(true);
    dropFocus();
    await act(async () => {
      answer.reject(new ApiError(429, 'rate_limited', 'x'));
      await settle();
    });
    expect(nameCard().getByRole('alert').textContent).toBe('Забагато спроб — спробуй за кілька хвилин');
    expect(document.activeElement).toBe(button(nameCard(), 'Зберегти імʼя'));
  });

  it('closes on «Скасувати» (or the same name) and gives the focus back to «Змінити»', async () => {
    await renderPage();
    openRename();
    fireEvent.click(button(nameCard(), 'Скасувати'));
    expect(nameCard().queryByLabelText('Нове імʼя')).toBeNull();
    expect(document.activeElement).toBe(button(nameCard(), 'Змінити'));

    openRename();
    fireEvent.click(button(nameCard(), 'Зберегти імʼя'));
    expect(nameCard().queryByLabelText('Нове імʼя')).toBeNull();
    expect(mocks.api.account.rename).not.toHaveBeenCalled();
  });

  it('needs the internet to save', async () => {
    await renderPage();
    openRename();
    setOnline(false);
    expect(button(nameCard(), 'Зберегти імʼя').disabled).toBe(true);
    expect(nameCard().getByText('Потрібен інтернет')).toBeTruthy();
  });
});

describe('«Підрахунки калорій»', () => {
  it('shows what is left today «з L», only while AI is on', async () => {
    mocks.api.foodStatus.mockResolvedValue({ enabled: true, remainingToday: 37, limitToday: 40 });
    await renderPage();
    expect(region('Підрахунки калорій').getByText('Сьогодні ще 37 з 40')).toBeTruthy();
  });

  it('leaves «з L» out without limitToday (an older server)', async () => {
    mocks.api.foodStatus.mockResolvedValue({ enabled: true, remainingToday: 12 });
    await renderPage();
    expect(region('Підрахунки калорій').getByText('Сьогодні ще 12')).toBeTruthy();
  });

  it('is not there when AI is off or the status cannot be loaded', async () => {
    await renderPage();
    expect(screen.queryByRole('region', { name: 'Підрахунки калорій' })).toBeNull();
    cleanup();
    mocks.api.foodStatus.mockRejectedValue(new ApiError(0, 'network', 'x'));
    await renderPage();
    expect(screen.queryByRole('region', { name: 'Підрахунки калорій' })).toBeNull();
  });
});
