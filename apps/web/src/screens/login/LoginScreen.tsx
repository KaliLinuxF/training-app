import { LINK_PATHS, parseLink } from '@legko/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/auth';
import { authEnv } from '../../auth/env';
import { storeLinkToken } from '../../auth/linkToken';
import { useDataStore } from '../../store/data';
import { describedBy, Field, PasswordInput, UsernameInput } from './fields';
import { canAutofocus, FORGOT_HINT, LOGIN_ERRORS, loginErrorText, showsForgotHint } from './loginErrors';
import s from './LoginScreen.module.css';
import { LogoMark } from './LogoMark';

export const PASTE_LINK = {
  open: 'Маю посилання',
  label: 'Встав посилання із запрошенням або для нового пароля',
  submit: 'Відкрити',
  invalid: 'Це не схоже на посилання з Легко',
} as const;

export const LOGIN_FOOTER =
  'Немає акаунта або не памʼятаєш пароль? Попроси в адміністратора запрошення чи посилання для нового пароля.';

/** Username + password login (§9.1). On success `AuthGate` swaps this screen for the app. */
export function LoginScreen() {
  const { login, offline, user } = useAuth();
  const pending = useDataStore((st) => st.sync.pending);
  const id = useId();
  const ids = {
    username: `${id}-username`,
    password: `${id}-password`,
    error: `${id}-error`,
    forgot: `${id}-forgot`,
    paste: `${id}-paste`,
    pasteError: `${id}-paste-error`,
  };
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLInputElement>(null);
  const [autoFocus] = useState(canAutofocus);
  // After a session expiry the device user's name is filled in.
  const [username, setUsername] = useState(() => user?.username ?? '');
  const [prefilled] = useState(() => (user?.username ?? '') !== '');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; credentials: boolean } | null>(null);
  const [forgot, setForgot] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await login(username.trim(), password);
      // `cancelled`: the switch confirm was declined; `switched`: the page reloads.
      if (result === 'cancelled') setBusy(false);
    } catch (err) {
      const text = loginErrorText(err);
      setError({ text, credentials: text === LOGIN_ERRORS.badCredentials });
      setForgot(showsForgotHint(err));
      setBusy(false);
      if (autoFocus) passwordRef.current?.select();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (busy) return;
    if (!username.trim()) {
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      passwordRef.current?.focus();
      return;
    }
    void submit();
  }

  function openPasted(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const link = parseLink(pasted, window.location.origin);
    if (!link) {
      setPasteError(true);
      pasteRef.current?.focus();
      return;
    }
    storeLinkToken(link);
    authEnv().replace(LINK_PATHS[link.kind]);
  }

  const showPendingHint = user !== null && pending > 0;

  return (
    <main className={s.page}>
      <div className={s.column}>
        <header className={s.brand}>
          <LogoMark className={s.logo} />
          <h1 className={s.title}>Легко</h1>
          <p className={s.subtitle}>Твій персональний трекер</p>
        </header>

        {/* Before the form: read before signing in (as someone else). */}
        {showPendingHint ? (
          <p className={s.pending}>
            На цьому пристрої є зміни {user.username}, ще не надіслані на сервер. Увійди як {user.username},
            щоб їх надіслати.
          </p>
        ) : null}

        <form className={s.card} onSubmit={handleSubmit} noValidate>
          <Field id={ids.username} label="Імʼя користувача">
            <UsernameInput
              ref={usernameRef}
              id={ids.username}
              autoComplete="username"
              enterKeyHint="next"
              autoFocus={autoFocus && !prefilled}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              aria-invalid={error?.credentials ? true : undefined}
              aria-describedby={error?.credentials ? ids.error : undefined}
            />
          </Field>
          <Field id={ids.password} label="Пароль">
            <PasswordInput
              ref={passwordRef}
              id={ids.password}
              name="password"
              autoComplete="current-password"
              enterKeyHint="go"
              autoFocus={autoFocus && prefilled}
              visible={visible}
              onToggle={() => setVisible((v) => !v)}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(error && ids.error, forgot && ids.forgot)}
            />
          </Field>

          {error ? (
            <p id={ids.error} className={s.error} role="alert">
              {error.text}
            </p>
          ) : null}
          {forgot ? (
            <p id={ids.forgot} className={s.fieldHint}>
              {FORGOT_HINT}
            </p>
          ) : null}

          <button type="submit" className={s.submit} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Входжу…' : 'Увійти'}
          </button>
        </form>

        {offline ? (
          <p className={s.hint}>Немає зʼєднання з сервером. Увійти можна, щойно зʼявиться інтернет.</p>
        ) : null}
        {/* After a failed login the hint in the card says the same: show the advice once. Nothing left to show →
            no empty footer (it would double the column gap above the paste field). */}
        {forgot && pasteOpen ? null : (
          <div className={s.footer}>
            {forgot ? null : <p className={s.hint}>{LOGIN_FOOTER}</p>}
            {pasteOpen ? null : (
              <button type="button" className={s.ghost} onClick={() => setPasteOpen(true)}>
                {PASTE_LINK.open}
              </button>
            )}
          </div>
        )}

        {pasteOpen ? (
          <form className={s.card} onSubmit={openPasted} noValidate>
            <Field id={ids.paste} label={PASTE_LINK.label}>
              <input
                ref={pasteRef}
                id={ids.paste}
                className={`${s.input} ${s.plain}`}
                type="url"
                inputMode="url"
                name="link"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoFocus
                placeholder="https://…"
                value={pasted}
                onChange={(e) => {
                  setPasted(e.target.value);
                  setPasteError(false);
                }}
                aria-invalid={pasteError ? true : undefined}
                aria-describedby={pasteError ? ids.pasteError : undefined}
              />
            </Field>
            {pasteError ? (
              <p id={ids.pasteError} className={s.error} role="alert">
                {PASTE_LINK.invalid}
              </p>
            ) : null}
            <button type="submit" className={s.secondary}>
              {PASTE_LINK.submit}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
