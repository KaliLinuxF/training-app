import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../auth/auth';
import { setAuthEnv } from '../../auth/env';
import { LINK_TOKEN_KEY } from '../../auth/linkToken';
import type * as ApiModule from '../../lib/api';
import { ApiError } from '../../lib/api';
import { bindOwner, resetLocal, useDataStore } from '../../store/data';
import { initialSyncState } from '../../store/state';
import { deferred, sessionUser } from '../../store/test-utils';
import { installMatchMedia } from '../../ui/internal/testing';
import { LOGIN_FOOTER, LoginScreen, PASTE_LINK } from './LoginScreen';
import { FORGOT_HINT, LOGIN_ERRORS, loginErrorText, showsForgotHint } from './loginErrors';

const mocks = vi.hoisted(() => ({ api: { login: vi.fn(), logout: vi.fn() } }));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', async () => (await import('../../store/test-utils')).fakeIdb());

const OLYA = sessionUser({ id: 'b2'.padEnd(32, '0'), username: 'olya' });
const TOKEN = 'T'.repeat(43);

const nameField = () => screen.getByLabelText<HTMLInputElement>('Імʼя користувача');
const passwordField = () => screen.getByLabelText<HTMLInputElement>('Пароль');
const submitButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Увійти|Входжу…)$/ });

function submitWith(username: string, password: string): void {
  fireEvent.change(nameField(), { target: { value: username } });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(submitButton());
}

let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreEnv: () => void;
const originalMatchMedia = window.matchMedia;

beforeEach(async () => {
  mocks.api.login.mockReset();
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
  (window as { matchMedia?: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('LoginScreen', () => {
  it('renders the brand, the username and password fields — and no hidden fixed account name', () => {
    const { container } = render(<LoginScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Home Fit' })).toBeTruthy();
    expect(screen.getByText('Твій персональний трекер')).toBeTruthy();
    const name = nameField();
    expect(name.type).toBe('text');
    expect(name.autocomplete).toBe('username');
    expect(name.getAttribute('autocapitalize')).toBe('none');
    expect(name.getAttribute('autocorrect')).toBe('off');
    expect(name.getAttribute('spellcheck')).toBe('false');
    expect(name.getAttribute('enterkeyhint')).toBe('next');
    expect(name.value).toBe('');
    expect(passwordField().type).toBe('password');
    expect(passwordField().autocomplete).toBe('current-password');
    expect(container.querySelectorAll('input[autocomplete="username"]')).toHaveLength(1);
    expect(container.querySelector('input[value="legko"]')).toBeNull();
  });

  it('submits the name and the password and shows the loading state', async () => {
    const pending = deferred<{ ok: true; user: typeof OLYA }>();
    mocks.api.login.mockReturnValue(pending.promise);
    render(<LoginScreen />);

    submitWith(' olya ', 'секрет-123');

    expect(mocks.api.login).toHaveBeenCalledWith('olya', 'секрет-123');
    expect(submitButton().textContent).toBe('Входжу…');
    expect(submitButton().disabled).toBe(true);

    pending.resolve({ ok: true, user: OLYA });
    await vi.waitFor(() => expect(useAuthStore.getState()).toMatchObject({ status: 'authed', user: OLYA }));
  });

  it('submits with Enter in the field', () => {
    mocks.api.login.mockReturnValue(new Promise(() => undefined));
    render(<LoginScreen />);

    fireEvent.change(nameField(), { target: { value: 'olya' } });
    fireEvent.change(passwordField(), { target: { value: 'pw' } });
    fireEvent.submit(passwordField().form as HTMLFormElement);

    expect(mocks.api.login).toHaveBeenCalledWith('olya', 'pw');
  });

  it('an empty name focuses the name, an empty password the password', () => {
    render(<LoginScreen />);
    fireEvent.change(passwordField(), { target: { value: 'pw' } });
    fireEvent.click(submitButton());
    expect(document.activeElement).toBe(nameField());

    fireEvent.change(nameField(), { target: { value: 'olya' } });
    fireEvent.change(passwordField(), { target: { value: '' } });
    fireEvent.click(submitButton());
    expect(document.activeElement).toBe(passwordField());
    expect(mocks.api.login).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(401, 'bad_credentials', 'Неправильне імʼя або пароль'), LOGIN_ERRORS.badCredentials, true],
    [new ApiError(401, 'bad_password', 'Wrong password'), LOGIN_ERRORS.badCredentials, true],
    [new ApiError(429, 'rate_limited', 'Too many attempts'), LOGIN_ERRORS.rateLimited, true],
    [new ApiError(403, 'account_disabled', 'Disabled'), LOGIN_ERRORS.accountDisabled, false],
    [new ApiError(0, 'network', 'offline'), LOGIN_ERRORS.network, false],
    [new ApiError(200, 'outdated_server', 'old'), LOGIN_ERRORS.other, false],
    [new ApiError(403, 'forbidden_origin', 'Forbidden'), LOGIN_ERRORS.other, false],
  ])('explains a failed login (%s)', async (err, message, forgot) => {
    mocks.api.login.mockRejectedValue(err);
    render(<LoginScreen />);

    submitWith('olya', 'pw');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(submitButton().textContent).toBe('Увійти');
    expect(submitButton().disabled).toBe(false);
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
    expect(Boolean(screen.queryByText(FORGOT_HINT))).toBe(forgot);
    // The advice is shown once: the footer repeating it is hidden exactly while the hint in the card shows.
    expect(Boolean(screen.queryByText(LOGIN_FOOTER))).toBe(!forgot);
    expect(screen.getByRole('button', { name: PASTE_LINK.open })).toBeTruthy();

    fireEvent.change(passwordField(), { target: { value: 'pw2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // Typing again keeps the hint, so the footer stays hidden (no jump while she types).
    expect(Boolean(screen.queryByText(FORGOT_HINT))).toBe(forgot);
    expect(Boolean(screen.queryByText(LOGIN_FOOTER))).toBe(!forgot);
  });

  it('after a failed login with the paste field open, no empty footer is left between the two cards', async () => {
    mocks.api.login.mockRejectedValue(new ApiError(401, 'bad_credentials', 'x'));
    const { container } = render(<LoginScreen />);
    submitWith('olya', 'pw');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.open }));

    const column = container.querySelector('main > div') as HTMLElement;
    const forms = Array.from(column.children).filter((el) => el.tagName === 'FORM');
    expect(forms).toHaveLength(2);
    // Brand, login form, paste form — nothing in between.
    expect(forms[0]?.nextElementSibling).toBe(forms[1]);
    expect(screen.queryByText(LOGIN_FOOTER)).toBeNull();
    expect(screen.getByText(FORGOT_HINT)).toBeTruthy();
  });

  it('the forgotten-password hint is a whole sentence', async () => {
    mocks.api.login.mockRejectedValue(new ApiError(401, 'bad_credentials', 'x'));
    render(<LoginScreen />);
    submitWith('olya', 'pw');
    await screen.findByRole('alert');
    expect(
      screen.getByText('Не памʼятаєш пароль? Попроси в адміністратора посилання для нового пароля.'),
    ).toBeTruthy();
  });

  it('marks the name too after a wrong name or password (the same answer for an unknown name)', async () => {
    mocks.api.login.mockRejectedValue(new ApiError(401, 'bad_credentials', 'x'));
    render(<LoginScreen />);
    submitWith('nobody', 'pw');
    await screen.findByRole('alert');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(passwordField().getAttribute('aria-describedby')).toContain(
      screen.getByText(FORGOT_HINT).getAttribute('id') ?? 'missing',
    );
  });

  it('shows and hides the password', () => {
    render(<LoginScreen />);
    const toggle = screen.getByRole('button', { name: 'Показати пароль' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(passwordField().type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(passwordField().type).toBe('password');
  });

  it('does not autofocus without a fine pointer (jsdom has no matchMedia, like an iPhone)', () => {
    render(<LoginScreen />);
    expect(document.activeElement).not.toBe(passwordField());
    expect(document.activeElement).not.toBe(nameField());
  });

  it('on a desktop focuses the name, or the password when the name is filled in', () => {
    installMatchMedia((query) => query === '(hover: hover) and (pointer: fine)');
    const first = render(<LoginScreen />);
    expect(document.activeElement).toBe(nameField());
    first.unmount();

    useAuthStore.setState({ status: 'anon', offline: false, user: OLYA });
    render(<LoginScreen />);
    expect(nameField().value).toBe('olya');
    expect(document.activeElement).toBe(passwordField());
  });

  it('fills in the device user’s name after a session expiry and hints at the unsent changes', () => {
    useAuthStore.setState({ status: 'anon', offline: false, user: OLYA });
    useDataStore.setState({ sync: { ...initialSyncState(), pending: 2 } });
    render(<LoginScreen />);

    expect(nameField().value).toBe('olya');
    const notice = screen.getByText(
      'На цьому пристрої є зміни olya, ще не надіслані на сервер. Увійди як olya, щоб їх надіслати.',
    );
    // Read before the form, not after the «Увійти» button.
    const form = nameField().form as HTMLFormElement;
    expect(notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.contains(notice)).toBe(false);
    // Between the brand and the form.
    const brand = screen.getByRole('heading', { level: 1, name: 'Home Fit' });
    expect(brand.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no pending hint without unsent changes', () => {
    useAuthStore.setState({ status: 'anon', offline: false, user: OLYA });
    render(<LoginScreen />);
    expect(screen.queryByText(/ще не надіслані на сервер/)).toBeNull();
  });

  it('shows the offline hint', () => {
    useAuthStore.setState({ status: 'anon', offline: true, user: null });
    render(<LoginScreen />);
    expect(screen.getByText(/Немає зʼєднання з сервером/)).toBeTruthy();
  });

  it('a declined switch confirm leaves the form usable', async () => {
    mocks.api.login.mockResolvedValue({ ok: true, user: OLYA });
    const signedIn = vi
      .spyOn((await import('../../auth/auth')).authActions, 'signedIn')
      .mockResolvedValue('cancelled');
    render(<LoginScreen />);
    submitWith('olya', 'pw');
    await vi.waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(signedIn).toHaveBeenCalledWith(OLYA);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('«Маю посилання»', () => {
  const linkField = () => screen.getByLabelText<HTMLInputElement>(PASTE_LINK.label);

  it('says how to get an account and opens the paste field', () => {
    render(<LoginScreen />);
    expect(screen.getByText(LOGIN_FOOTER)).toBeTruthy();
    expect(screen.queryByLabelText(PASTE_LINK.label)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.open }));

    const field = linkField();
    expect(field.type).toBe('url');
    expect(field.getAttribute('inputmode')).toBe('url');
    expect(field.getAttribute('autocapitalize')).toBe('none');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(document.activeElement).toBe(field);
  });

  it('opens a pasted invite inside this app', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.open }));
    fireEvent.change(linkField(), { target: { value: ` ${window.location.origin}/invite#${TOKEN} ` } });
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.submit }));

    expect(JSON.parse(sessionStorage.getItem(LINK_TOKEN_KEY) ?? 'null')).toEqual({ kind: 'invite', token: TOKEN });
    expect(replace).toHaveBeenCalledWith('/invite');
  });

  it('opens a pasted reset link too', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.open }));
    fireEvent.change(linkField(), { target: { value: `${window.location.origin}/reset#${TOKEN}` } });
    fireEvent.submit(linkField().form as HTMLFormElement);
    expect(replace).toHaveBeenCalledWith('/reset');
  });

  it.each([
    ['another site', `https://example.com/invite#${TOKEN}`],
    ['no token', `${window.location.origin}/invite`],
    ['a damaged token', `${window.location.origin}/invite#abc`],
    ['another page', `${window.location.origin}/settings#${TOKEN}`],
    ['not a link', 'привіт'],
  ])('refuses %s', (_what, value) => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.open }));
    fireEvent.change(linkField(), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: PASTE_LINK.submit }));

    expect(screen.getByRole('alert').textContent).toBe(PASTE_LINK.invalid);
    expect(linkField().getAttribute('aria-invalid')).toBe('true');
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();

    fireEvent.change(linkField(), { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('loginErrorText', () => {
  it('treats 5xx as a connection problem and anything unknown as generic', () => {
    expect(loginErrorText(new ApiError(502, 'internal', 'Bad Gateway'))).toBe(LOGIN_ERRORS.network);
    expect(loginErrorText(new TypeError('boom'))).toBe(LOGIN_ERRORS.other);
    expect(showsForgotHint(new TypeError('boom'))).toBe(false);
  });
});
