import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../auth/auth';
import type * as ApiModule from '../../lib/api';
import { ApiError } from '../../lib/api';
import { deferred } from '../../store/test-utils';
import { LoginScreen } from './LoginScreen';
import { LOGIN_ERRORS, loginErrorText } from './loginErrors';

const mocks = vi.hoisted(() => ({ api: { login: vi.fn() } }));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => ({ getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() }));

const passwordField = () => screen.getByLabelText<HTMLInputElement>('Пароль');
const submitButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Увійти|Входжу/ });

function submitWith(password: string): void {
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(submitButton());
}

beforeEach(() => {
  mocks.api.login.mockReset();
  useAuthStore.setState({ status: 'anon', offline: false });
});

afterEach(cleanup);

describe('LoginScreen', () => {
  it('renders the brand, the password field and a Keychain username', () => {
    const { container } = render(<LoginScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Легко' })).toBeTruthy();
    expect(screen.getByText('Твій персональний трекер')).toBeTruthy();
    expect(passwordField().type).toBe('password');
    expect(passwordField().autocomplete).toBe('current-password');
    const username = container.querySelector<HTMLInputElement>('input[autocomplete="username"]');
    expect(username?.value).toBe('legko');
    expect(username?.tabIndex).toBe(-1);
  });

  it('submits the password and shows the loading state', async () => {
    const pending = deferred<{ ok: true }>();
    mocks.api.login.mockReturnValue(pending.promise);
    render(<LoginScreen />);

    submitWith('секрет');

    expect(mocks.api.login).toHaveBeenCalledWith('секрет');
    expect(submitButton().textContent).toBe('Входжу…');
    expect(submitButton().disabled).toBe(true);

    pending.resolve({ ok: true });
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authed'));
  });

  it('submits with Enter in the field', () => {
    mocks.api.login.mockReturnValue(new Promise(() => undefined));
    render(<LoginScreen />);

    fireEvent.change(passwordField(), { target: { value: 'pw' } });
    fireEvent.submit(passwordField().form as HTMLFormElement);

    expect(mocks.api.login).toHaveBeenCalledWith('pw');
  });

  it('does nothing without a password', () => {
    render(<LoginScreen />);
    fireEvent.click(submitButton());
    expect(mocks.api.login).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(passwordField());
  });

  it.each([
    [new ApiError(401, 'bad_password', 'Wrong password'), LOGIN_ERRORS.badPassword],
    [new ApiError(429, 'rate_limited', 'Too many attempts'), LOGIN_ERRORS.rateLimited],
    [new ApiError(0, 'network', 'offline'), LOGIN_ERRORS.network],
    [new ApiError(403, 'forbidden_origin', 'Forbidden'), LOGIN_ERRORS.other],
  ])('explains a failed login (%s)', async (err, message) => {
    mocks.api.login.mockRejectedValue(err);
    render(<LoginScreen />);

    submitWith('pw');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(submitButton().textContent).toBe('Увійти');
    expect(submitButton().disabled).toBe(false);
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(passwordField(), { target: { value: 'pw2' } });
    expect(screen.queryByRole('alert')).toBeNull();
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
  });

  it('shows the offline hint', () => {
    useAuthStore.setState({ status: 'anon', offline: true });
    render(<LoginScreen />);
    expect(screen.getByText(/Немає зʼєднання з сервером/)).toBeTruthy();
  });
});

describe('loginErrorText', () => {
  it('treats 5xx as a connection problem and anything unknown as generic', () => {
    expect(loginErrorText(new ApiError(502, 'internal', 'Bad Gateway'))).toBe(LOGIN_ERRORS.network);
    expect(loginErrorText(new TypeError('boom'))).toBe(LOGIN_ERRORS.other);
  });
});
