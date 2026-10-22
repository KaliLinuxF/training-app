import type { ResetCheckResponse } from '@legko/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authActions, useAuthStore } from '../../auth/auth';
import { setAuthEnv } from '../../auth/env';
import { LINK_TOKEN_KEY } from '../../auth/linkToken';
import type * as ApiModule from '../../lib/api';
import { ApiError } from '../../lib/api';
import type * as PlatformModule from '../../lib/platform';
import { bindOwner, resetLocal } from '../../store/data';
import { sessionUser } from '../../store/test-utils';
import { COPY_LINK } from './LinkParts';
import { ASK_ADMIN, LINK_FORM_ERRORS, LOGIN_ERRORS, RESET_INVALID, untilDateTime } from './loginErrors';
import { RESET_SIGN_OUT_NOTE, ResetScreen } from './ResetScreen';

const mocks = vi.hoisted(() => ({
  api: { resetCheck: vi.fn(), resetComplete: vi.fn(), logout: vi.fn(), me: vi.fn() },
  isIOS: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
}));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('../../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  isIOS: mocks.isIOS,
  isStandalone: mocks.isStandalone,
}));
vi.mock('idb-keyval', async () => (await import('../../store/test-utils')).fakeIdb());

const TOKEN = 'R'.repeat(43);
const EXPIRES = new Date(2026, 9, 22, 14, 5).getTime();
const ANNA = sessionUser({ id: 'a1'.padEnd(32, '0'), username: 'anna', legacyOwner: true });
const ADMIN = sessionUser({ id: 'c3'.padEnd(32, '0'), username: 'admin', role: 'admin' });

const check = (patch: Partial<ResetCheckResponse> = {}): ResetCheckResponse => ({
  ok: true,
  username: 'anna',
  purpose: 'reset',
  expiresAt: EXPIRES,
  ...patch,
});

let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreEnv: () => void;

const passwordField = () => screen.getByLabelText<HTMLInputElement>('Новий пароль');
const repeatField = () => screen.getByLabelText<HTMLInputElement>('Повтори пароль');
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Зберегти пароль|Зберігаю…)$/ });

function openAt(hash = `#${TOKEN}`) {
  window.history.replaceState(null, '', `/reset${hash}`);
  return render(<ResetScreen />);
}

async function fill(password: string, repeat = password) {
  await screen.findByRole('button', { name: 'Зберегти пароль' });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.change(repeatField(), { target: { value: repeat } });
}

beforeEach(async () => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.resetCheck.mockResolvedValue(check());
  mocks.api.logout.mockResolvedValue({ ok: true });
  mocks.isIOS.mockReturnValue(false);
  mocks.isStandalone.mockReturnValue(false);
  replace = vi.fn();
  restoreEnv = setAuthEnv({ replace, openChannel: () => null, session: () => sessionStorage });
  bindOwner(null);
  await resetLocal();
  sessionStorage.clear();
  useAuthStore.setState({ status: 'anon', offline: false, user: null });
});

afterEach(() => {
  cleanup();
  restoreEnv();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('ResetScreen', () => {
  it('a reset: title, whose password, the Keychain name, the sign-out note; the fragment is stripped', async () => {
    const { container } = openAt();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset');
    expect(JSON.parse(sessionStorage.getItem(LINK_TOKEN_KEY) ?? 'null')).toEqual({ kind: 'reset', token: TOKEN });

    expect(await screen.findByRole('heading', { level: 1, name: 'Новий пароль' })).toBeTruthy();
    expect(mocks.api.resetCheck).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('для anna')).toBeTruthy();
    const hidden = container.querySelector<HTMLInputElement>('input[autocomplete="username"]');
    expect(hidden?.value).toBe('anna');
    expect(hidden?.tabIndex).toBe(-1);
    expect(passwordField().autocomplete).toBe('new-password');
    expect(repeatField().autocomplete).toBe('new-password');
    expect(screen.getByText(RESET_SIGN_OUT_NOTE)).toBeTruthy();
    expect(RESET_SIGN_OUT_NOTE).toBe('Після цього всі пристрої, де ввійдено в акаунт, вийдуть з нього.');
  });

  it('a setup link (no password yet): «Створення пароля» and when the link expires', async () => {
    mocks.api.resetCheck.mockResolvedValue(check({ username: 'admin', purpose: 'setup' }));
    openAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Створення пароля' })).toBeTruthy();
    expect(screen.getByText('для admin')).toBeTruthy();
    expect(untilDateTime(EXPIRES)).toBe('22 жовтня, 14:05');
    expect(screen.getByText('Посилання одноразове, діє до 22 жовтня, 14:05.')).toBeTruthy();
  });

  it.each([
    ['used', false],
    ['expired', true],
    ['revoked', true],
    ['unknown', true],
  ] as const)('explains a %s link (advice: %s)', async (reason, askAdmin) => {
    mocks.api.resetCheck.mockRejectedValue(new ApiError(410, 'link_invalid', 'x', undefined, reason));
    useAuthStore.setState({ status: 'anon', offline: false, user: ANNA });
    openAt();
    expect(await screen.findByText(RESET_INVALID[reason])).toBeTruthy();
    expect(Boolean(screen.queryByText(ASK_ADMIN))).toBe(askAdmin);
    expect(RESET_INVALID.used).toBe('Це посилання вже використали. Якщо пароль уже змінено — увійди з ним.');
    expect(RESET_INVALID.revoked).toBe('Посилання скасовано — є новіше.');
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити Home Fit' }));
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('another account signed in here: sign out first', async () => {
    mocks.api.resetCheck.mockResolvedValue(check({ username: 'admin' }));
    useAuthStore.setState({ status: 'authed', offline: false, user: ANNA });
    const logout = vi.spyOn(authActions, 'logout').mockResolvedValue(true);
    openAt();

    expect(await screen.findByText('Це посилання для admin, а на цьому пристрої ввійдено як anna.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вийти й продовжити' }));
    expect(logout).toHaveBeenCalledWith('/reset');
    expect(screen.getByRole('button', { name: 'Повернутися в застосунок' })).toBeTruthy();
  });

  it('the same account goes straight to the form (names compare case-insensitively)', async () => {
    mocks.api.resetCheck.mockResolvedValue(check({ username: 'Anna' }));
    useAuthStore.setState({ status: 'authed', offline: false, user: ANNA });
    openAt();
    expect(await screen.findByRole('button', { name: 'Зберегти пароль' })).toBeTruthy();
  });

  it.each([
    ['short', 'short', LINK_FORM_ERRORS.weakPassword, 'password'],
    ['password1', 'password2', LINK_FORM_ERRORS.mismatch, 'repeat'],
  ])('checks «%s» / «%s» on the device first', async (password, repeat, message, field) => {
    openAt();
    await fill(password, repeat);
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert').textContent).toBe(message);
    const target = field === 'password' ? passwordField() : repeatField();
    expect(target.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(target);
    expect(mocks.api.resetComplete).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(403, 'account_disabled', 'x'), LOGIN_ERRORS.accountDisabled],
    [new ApiError(400, 'weak_password', 'x'), LINK_FORM_ERRORS.weakPassword],
    [new ApiError(429, 'rate_limited', 'x'), LOGIN_ERRORS.rateLimited],
    [new ApiError(0, 'network', 'x'), LOGIN_ERRORS.network],
    [new ApiError(200, 'outdated_server', 'x'), LOGIN_ERRORS.other],
  ])('maps a refused reset (%s)', async (err, message) => {
    mocks.api.resetComplete.mockRejectedValue(err);
    openAt();
    await fill('password1');
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(saveButton().disabled).toBe(false);
  });

  it('saves the password, signs in and lands at home', async () => {
    mocks.api.resetComplete.mockResolvedValue({ ok: true, user: ANNA });
    openAt();
    await fill('password1');
    fireEvent.click(saveButton());
    expect(mocks.api.resetComplete).toHaveBeenCalledWith({ token: TOKEN, password: 'password1' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', user: ANNA });
    expect(saveButton().textContent).toBe('Зберігаю…');
  });

  it('the admin’s setup lands on «Користувачі»', async () => {
    mocks.api.resetCheck.mockResolvedValue(check({ username: 'admin', purpose: 'setup' }));
    mocks.api.resetComplete.mockResolvedValue({ ok: true, user: ADMIN });
    openAt();
    await fill('a-long-admin-password');
    fireEvent.click(saveButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/users'));
  });

  it('a link used meanwhile shows the per-reason state', async () => {
    mocks.api.resetComplete.mockRejectedValue(new ApiError(410, 'link_invalid', 'x', undefined, 'used'));
    openAt();
    await fill('password1');
    fireEvent.click(saveButton());
    expect(await screen.findByText(RESET_INVALID.used)).toBeTruthy();
    expect(screen.queryByText(ASK_ADMIN)).toBeNull();
  });

  describe('in iOS Safari', () => {
    beforeEach(() => {
      mocks.isIOS.mockReturnValue(true);
    });

    it('notes the paste path and, once saved, shows «Готово» instead of reloading', async () => {
      mocks.api.resetComplete.mockResolvedValue({ ok: true, user: ANNA });
      openAt();
      await fill('password1');
      expect(screen.getByText(COPY_LINK.note)).toBeTruthy();
      fireEvent.click(saveButton());

      expect(await screen.findByRole('heading', { level: 1, name: 'Пароль збережено' })).toBeTruthy();
      expect(screen.getByText(/^Імʼя для входу:/).textContent).toBe('Імʼя для входу: anna');
      expect(screen.getByText('Відкрий Home Fit з іконки й увійди з новим паролем.')).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Продовжити в Safari' }));
      expect(replace).toHaveBeenCalledWith('/');
    });
  });
});
