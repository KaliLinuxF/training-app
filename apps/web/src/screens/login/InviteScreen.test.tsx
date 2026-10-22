import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authActions, useAuthStore } from '../../auth/auth';
import { setAuthEnv } from '../../auth/env';
import { LINK_TOKEN_KEY } from '../../auth/linkToken';
import type * as ApiModule from '../../lib/api';
import { ApiError } from '../../lib/api';
import type * as PlatformModule from '../../lib/platform';
import { bindOwner, resetLocal } from '../../store/data';
import { deferred, sessionUser } from '../../store/test-utils';
import { useUiStore } from '../../store/ui';
import { INVITE_ADMIN_NOTE, InviteScreen } from './InviteScreen';
import { COPY_LINK } from './LinkParts';
import { ASK_ADMIN, INVITE_INVALID, LINK_FORM_ERRORS, LOGIN_ERRORS, untilDate, USERNAME_HINT } from './loginErrors';

const mocks = vi.hoisted(() => ({
  api: { inviteCheck: vi.fn(), inviteAccept: vi.fn(), logout: vi.fn(), me: vi.fn() },
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

const TOKEN = 'Tok3n_with-43-chars'.padEnd(43, 'x');
const EXPIRES = new Date(2026, 9, 28, 12, 0).getTime();
const OLYA = sessionUser({ id: 'b2'.padEnd(32, '0'), username: 'olya' });
const ANNA = sessionUser({ id: 'a1'.padEnd(32, '0'), username: 'anna', legacyOwner: true });

let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreEnv: () => void;

/** jsdom has no clipboard; removed again in afterEach. */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

const nameField = () => screen.getByLabelText<HTMLInputElement>('Імʼя користувача');
const passwordField = () => screen.getByLabelText<HTMLInputElement>('Пароль');
const repeatField = () => screen.getByLabelText<HTMLInputElement>('Повтори пароль');
const createButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Створити акаунт|Створюю…)$/ });

function openAt(hash = `#${TOKEN}`) {
  window.history.replaceState(null, '', `/invite${hash}`);
  return render(<InviteScreen />);
}

async function fill(username: string, password: string, repeat = password) {
  await screen.findByRole('button', { name: 'Створити акаунт' });
  fireEvent.change(nameField(), { target: { value: username } });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.change(repeatField(), { target: { value: repeat } });
}

beforeEach(async () => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.inviteCheck.mockResolvedValue({ ok: true, expiresAt: EXPIRES });
  mocks.api.logout.mockResolvedValue({ ok: true });
  mocks.isIOS.mockReturnValue(false);
  mocks.isStandalone.mockReturnValue(false);
  replace = vi.fn();
  restoreEnv = setAuthEnv({ replace, openChannel: () => null, session: () => sessionStorage });
  bindOwner(null);
  await resetLocal();
  sessionStorage.clear();
  useAuthStore.setState({ status: 'anon', offline: false, user: null });
  useUiStore.setState({ toast: null, confirm: null });
});

afterEach(() => {
  cleanup();
  restoreEnv();
  window.history.replaceState(null, '', '/');
  delete (navigator as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

describe('InviteScreen: the link', () => {
  it('moves the token from the fragment to sessionStorage, strips it and checks it', async () => {
    openAt();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');
    expect(JSON.parse(sessionStorage.getItem(LINK_TOKEN_KEY) ?? 'null')).toEqual({ kind: 'invite', token: TOKEN });
    // Loading: the splash.
    expect(screen.getByRole('status')).toBeTruthy();

    expect(await screen.findByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeTruthy();
    expect(mocks.api.inviteCheck).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('Обери імʼя і пароль — і можна починати')).toBeTruthy();
    expect(screen.getByText(`Посилання одноразове, діє до ${untilDate(EXPIRES)}.`)).toBeTruthy();
    expect(untilDate(EXPIRES)).toBe('28 жовтня');
  });

  it('a reload finds the token in sessionStorage', async () => {
    sessionStorage.setItem(LINK_TOKEN_KEY, JSON.stringify({ kind: 'invite', token: TOKEN }));
    openAt('');
    await screen.findByRole('button', { name: 'Створити акаунт' });
    expect(mocks.api.inviteCheck).toHaveBeenCalledWith(TOKEN);
  });

  it('a stored reset token is not an invite', async () => {
    sessionStorage.setItem(LINK_TOKEN_KEY, JSON.stringify({ kind: 'reset', token: TOKEN }));
    openAt('');
    expect(await screen.findByText(INVITE_INVALID.unknown)).toBeTruthy();
    expect(mocks.api.inviteCheck).not.toHaveBeenCalled();
  });

  it('a damaged fragment is an unknown link (no request) and forgets an older token', async () => {
    sessionStorage.setItem(LINK_TOKEN_KEY, JSON.stringify({ kind: 'invite', token: TOKEN }));
    openAt('#abc');
    expect(screen.getByRole('heading', { level: 1, name: 'Посилання не працює' })).toBeTruthy();
    expect(screen.getByText(INVITE_INVALID.unknown)).toBeTruthy();
    expect(screen.getByText(ASK_ADMIN)).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    expect(mocks.api.inviteCheck).not.toHaveBeenCalled();
  });

  it.each([
    ['used', false],
    ['expired', true],
    ['revoked', true],
    ['unknown', true],
  ] as const)('explains a %s invite (advice: %s)', async (reason, askAdmin) => {
    mocks.api.inviteCheck.mockRejectedValue(new ApiError(410, 'link_invalid', 'Посилання не працює', undefined, reason));
    openAt();
    expect(await screen.findByText(INVITE_INVALID[reason])).toBeTruthy();
    expect(Boolean(screen.queryByText(ASK_ADMIN))).toBe(askAdmin);
    if (reason === 'used') {
      expect(INVITE_INVALID.used).toBe(
        'Це запрошення вже використали. Якщо акаунт за ним уже створено — просто ввійди.',
      );
    }

    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(replace).toHaveBeenCalledWith('/');
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('offers «Відкрити Легко» instead when someone is signed in on this device', async () => {
    useAuthStore.setState({ status: 'anon', offline: false, user: ANNA });
    mocks.api.inviteCheck.mockRejectedValue(new ApiError(410, 'link_invalid', 'x', undefined, 'used'));
    openAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити Легко' }));
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('cannot reach the server: says so and tries again', async () => {
    mocks.api.inviteCheck.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    openAt();
    expect((await screen.findByRole('alert')).textContent).toBe(LOGIN_ERRORS.network);
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    expect(await screen.findByRole('button', { name: 'Створити акаунт' })).toBeTruthy();
    expect(mocks.api.inviteCheck).toHaveBeenCalledTimes(2);
  });

  it('waits for the session check before choosing the form or the interstitial', async () => {
    useAuthStore.setState({ status: 'checking', offline: false, user: null });
    openAt();
    await waitFor(() => expect(mocks.api.inviteCheck).toHaveBeenCalled());
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Створити акаунт' })).toBeNull();
  });
});

describe('InviteScreen: signed in on this device', () => {
  it('asks to sign out first; the way back keeps the app', async () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: ANNA });
    openAt();
    expect(
      await screen.findByText('На цьому пристрої вже ввійдено як anna. Щоб створити новий акаунт, спершу вийди.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Імʼя користувача')).toBeNull();
    expect(screen.queryByText(INVITE_ADMIN_NOTE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Повернутися в застосунок' }));
    expect(replace).toHaveBeenCalledWith('/');
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('«Вийти й продовжити» logs out back to /invite', async () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: ANNA });
    const logout = vi.spyOn(authActions, 'logout').mockResolvedValue(false);
    openAt();
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Вийти й продовжити' });
    fireEvent.click(button);
    expect(logout).toHaveBeenCalledWith('/invite');
    // Cancelled in the dialog: the button works again.
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});

describe('InviteScreen: the form', () => {
  it('says, inside the form and before «Створити акаунт», that the admin sees the records', async () => {
    openAt();
    const submit = await screen.findByRole('button', { name: 'Створити акаунт' });
    expect(INVITE_ADMIN_NOTE).toBe('Адміністратор бачить твої записи та прогрес.');
    const note = screen.getByText(INVITE_ADMIN_NOTE);
    expect(note.tagName).toBe('P');
    expect(note.closest('form')).toBe(submit.closest('form'));
    expect(note.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Directly above the button, after the fields.
    expect(note.nextElementSibling).toBe(submit);
    expect(repeatField().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The one-time-link hint stays below the form; nothing louder than a line.
    const once = screen.getByText(/^Посилання одноразове, діє до /);
    expect(once.closest('form')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(/Адміністратор бачить/)).toHaveLength(1);
  });

  it('keeps the line above the button while an error is shown', async () => {
    openAt();
    await fill('olya', 'short');
    fireEvent.click(createButton());
    const alert = await screen.findByRole('alert');
    const note = screen.getByText(INVITE_ADMIN_NOTE);
    expect(alert.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.nextElementSibling).toBe(createButton());
  });

  it('has the hints and the right autofill hints', async () => {
    openAt();
    await screen.findByRole('button', { name: 'Створити акаунт' });
    expect(nameField().autocomplete).toBe('username');
    expect(nameField().getAttribute('autocapitalize')).toBe('none');
    expect(nameField().getAttribute('autocorrect')).toBe('off');
    expect(nameField().getAttribute('spellcheck')).toBe('false');
    expect(passwordField().autocomplete).toBe('new-password');
    expect(repeatField().autocomplete).toBe('new-password');
    // Symbols are named, not bare («_» read as a blank, «-» as a stray dash), and each stays with its name.
    const hint = screen.getByText(
      '3–32 символи: латинські літери, цифри, крапка (.), дефіс (-) або підкреслення (_)',
    );
    expect(hint.textContent).toBe(
      '3–32 символи: латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
    );
    expect(nameField().getAttribute('aria-describedby')).toContain(hint.id);
    expect(screen.getByText('Щонайменше 8 символів')).toBeTruthy();
    // The eye reveals both password fields.
    fireEvent.click(screen.getByRole('button', { name: 'Показати пароль' }));
    expect(passwordField().type).toBe('text');
    expect(repeatField().type).toBe('text');
  });

  it.each([
    ['ol', 'password1', 'password1', LINK_FORM_ERRORS.invalidUsername, 'name'],
    ['оля', 'password1', 'password1', LINK_FORM_ERRORS.invalidUsername, 'name'],
    ['...', 'password1', 'password1', LINK_FORM_ERRORS.invalidUsername, 'name'],
    ['Admin', 'password1', 'password1', LINK_FORM_ERRORS.usernameReserved, 'name'],
    ['legko', 'password1', 'password1', LINK_FORM_ERRORS.usernameReserved, 'name'],
    ['olya', 'short', 'short', LINK_FORM_ERRORS.weakPassword, 'password'],
    ['olya', 'password1', 'password2', LINK_FORM_ERRORS.mismatch, 'repeat'],
  ])('checks «%s» / «%s» / «%s» on the device first', async (name, password, repeat, message, field) => {
    openAt();
    await fill(name, password, repeat);
    fireEvent.click(createButton());

    expect(screen.getByRole('alert').textContent).toBe(message);
    const target = field === 'name' ? nameField() : field === 'password' ? passwordField() : repeatField();
    expect(target.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(target);
    expect(mocks.api.inviteAccept).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409, 'username_taken', 'Це імʼя вже зайняте'), LINK_FORM_ERRORS.usernameTaken, 'name'],
    [new ApiError(400, 'invalid_username', 'x'), LINK_FORM_ERRORS.invalidUsername, 'name'],
    [new ApiError(400, 'weak_password', 'x'), LINK_FORM_ERRORS.weakPassword, 'password'],
    [new ApiError(429, 'rate_limited', 'x'), LOGIN_ERRORS.rateLimited, null],
    [new ApiError(0, 'network', 'x'), LOGIN_ERRORS.network, null],
    [new ApiError(200, 'outdated_server', 'x'), LOGIN_ERRORS.other, null],
  ])('maps a refused accept (%s)', async (err, message, field) => {
    mocks.api.inviteAccept.mockRejectedValue(err);
    openAt();
    await fill('olya', 'password1');
    fireEvent.click(createButton());

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(createButton().disabled).toBe(false);
    if (field === 'name') expect(nameField().getAttribute('aria-invalid')).toBe('true');
    if (field === 'password') expect(passwordField().getAttribute('aria-invalid')).toBe('true');
  });

  it('a link used up meanwhile (410 on accept) shows the per-reason state', async () => {
    mocks.api.inviteAccept.mockRejectedValue(new ApiError(410, 'link_invalid', 'x', undefined, 'revoked'));
    openAt();
    await fill('olya', 'password1');
    fireEvent.click(createButton());
    expect(await screen.findByText(INVITE_INVALID.revoked)).toBeTruthy();
  });

  it('creates the account and goes into the app (a new user lands at home)', async () => {
    const accepted = deferred<{ ok: true; user: typeof OLYA }>();
    mocks.api.inviteAccept.mockReturnValue(accepted.promise);
    openAt();
    await fill('  olya  ', 'password1');
    fireEvent.click(createButton());

    expect(mocks.api.inviteAccept).toHaveBeenCalledWith({ token: TOKEN, username: 'olya', password: 'password1' });
    expect(createButton().textContent).toBe('Створюю…');
    accepted.resolve({ ok: true, user: OLYA });

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', user: OLYA });
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    // Still the busy form until the reload (never the «already signed in» interstitial).
    expect(createButton().textContent).toBe('Створюю…');
  });

  it('an admin made by an invite lands on «Користувачі»', async () => {
    mocks.api.inviteAccept.mockResolvedValue({ ok: true, user: { ...OLYA, role: 'admin' } });
    openAt();
    await fill('olya', 'password1');
    fireEvent.click(createButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/users'));
  });
});

describe('the username rule copy', () => {
  it.each([
    ['the hint', USERNAME_HINT],
    ['the error', LINK_FORM_ERRORS.invalidUsername],
  ])('%s names every symbol and keeps it with its name', (_what, text) => {
    for (const [name, symbol] of [
      ['крапка', '.'],
      ['дефіс', '-'],
      ['підкреслення', '_'],
    ] as const) {
      expect(text).toContain(`${name}\u00A0(${symbol})`);
    }
    // No bare symbol in a list («крапка, _ або -»).
    expect(text).not.toMatch(/[,\s][._-](?:[,\s]|$)/);
    expect(text).toContain('3–32 символи');
  });
});

describe('InviteScreen in iOS Safari (D29)', () => {
  beforeEach(() => {
    mocks.isIOS.mockReturnValue(true);
    mocks.isStandalone.mockReturnValue(false);
  });

  it('offers to copy the link for the home-screen app', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    openAt();
    await screen.findByRole('button', { name: 'Створити акаунт' });
    expect(screen.getByText(COPY_LINK.note)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: COPY_LINK.button }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite#${TOKEN}`);
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe(COPY_LINK.copied));
  });

  it('shows the link as text when the clipboard refuses', async () => {
    stubClipboard(vi.fn(async () => Promise.reject(new Error('no'))));
    openAt();
    await screen.findByRole('button', { name: 'Створити акаунт' });
    fireEvent.click(screen.getByRole('button', { name: COPY_LINK.button }));
    expect(await screen.findByText(`${window.location.origin}/invite#${TOKEN}`)).toBeTruthy();
  });

  it('a finished invite shows «Готово» with the name and the install steps; «Продовжити в Safari» opens the app', async () => {
    mocks.api.inviteAccept.mockResolvedValue({ ok: true, user: OLYA });
    openAt();
    await fill('olya', 'password1');
    fireEvent.click(createButton());

    expect(await screen.findByRole('heading', { level: 1, name: 'Акаунт створено' })).toBeTruthy();
    expect(screen.getByText(/^Імʼя для входу:/).textContent).toBe('Імʼя для входу: olya');
    expect(
      screen.getByText(
        'Нагадування приходять у застосунок на початковому екрані. Додай Легко туди й один раз увійди з цим імʼям і паролем.',
      ),
    ).toBeTruthy();
    expect(within(screen.getByRole('list')).getAllByRole('listitem').length).toBeGreaterThan(2);
    expect(screen.queryByText(INVITE_ADMIN_NOTE)).toBeNull();
    // The storage work is done, the reload waits for her.
    expect(replace).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', user: OLYA });

    fireEvent.click(screen.getByRole('button', { name: 'Продовжити в Safari' }));
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('the installed app reloads at once (no «Готово»)', async () => {
    mocks.isStandalone.mockReturnValue(true);
    mocks.api.inviteAccept.mockResolvedValue({ ok: true, user: OLYA });
    openAt();
    await fill('olya', 'password1');
    fireEvent.click(createButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText(COPY_LINK.note)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Акаунт створено' })).toBeNull();
  });
});
