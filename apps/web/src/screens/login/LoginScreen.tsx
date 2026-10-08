import { useId, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/auth';
import s from './LoginScreen.module.css';
import { canAutofocus, loginErrorText } from './loginErrors';
import { LogoMark } from './LogoMark';

/** Single-password login. On success `AuthGate` swaps this screen for the app. */
export function LoginScreen() {
  const { login, offline } = useAuth();
  const id = useId();
  const passwordId = `${id}-password`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoFocus] = useState(canAutofocus);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(loginErrorText(err));
      setBusy(false);
      if (autoFocus) inputRef.current?.select();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      inputRef.current?.focus();
      return;
    }
    void submit();
  }

  return (
    <main className={s.page}>
      <div className={s.column}>
        <header className={s.brand}>
          <LogoMark className={s.logo} />
          <h1 className={s.title}>Легко</h1>
          <p className={s.subtitle}>Твій персональний трекер</p>
        </header>

        <form className={s.card} onSubmit={handleSubmit} noValidate>
          {/* Lets iOS Keychain / password managers store the password under a fixed account name. */}
          <input
            className="visually-hidden"
            type="text"
            name="username"
            autoComplete="username"
            defaultValue="legko"
            tabIndex={-1}
            aria-hidden="true"
          />
          <div className={s.field}>
            <label className={s.label} htmlFor={passwordId}>
              Пароль
            </label>
            <div className={s.control}>
              <input
                ref={inputRef}
                id={passwordId}
                className={s.input}
                type={visible ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoFocus={autoFocus}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              <button
                type="button"
                className={s.toggle}
                aria-label="Показати пароль"
                aria-pressed={visible}
                aria-controls={passwordId}
                // Keep focus (and the iPhone keyboard) in the field.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVisible((v) => !v)}
              >
                <EyeIcon crossed={visible} />
              </button>
            </div>
          </div>

          {error ? (
            <p id={errorId} className={s.error} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className={s.submit} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Входжу…' : 'Увійти'}
          </button>
        </form>

        {offline ? (
          <p className={s.hint}>Немає зʼєднання з сервером. Увійти можна, щойно зʼявиться інтернет.</p>
        ) : null}
      </div>
    </main>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}
