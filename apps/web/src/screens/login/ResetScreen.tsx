import {
  LINK_PATHS,
  PASSWORD_LIMITS,
  usernameKey,
  type LinkProblem,
  type ResetCheckResponse,
} from '@legko/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { authActions, landingPath, useAuth } from '../../auth/auth';
import { Splash } from '../../auth/Splash';
import { api, ApiError } from '../../lib/api';
import { describedBy, Field, PasswordInput } from './fields';
import {
  AuthPage,
  CopyLinkNote,
  inIosSafari,
  LinkDone,
  LinkInterstitial,
  LinkInvalid,
  LinkRetry,
} from './LinkParts';
import { LINK_FORM_ERRORS, linkRequestErrorText, PASSWORD_HINT, RESET_INVALID, untilDateTime } from './loginErrors';
import s from './LoginScreen.module.css';
import { useLinkCheck } from './useLinkCheck';

export const RESET_TITLES = { reset: 'Новий пароль', setup: 'Створення пароля' } as const;
export const RESET_SIGN_OUT_NOTE = 'Після цього всі пристрої, де ввійдено в акаунт, вийдуть з нього.';

const checkReset = (token: string): Promise<ResetCheckResponse> => api.resetCheck(token);

type FieldName = 'password' | 'repeat';
interface FormError {
  text: string;
  field: FieldName | null;
}

/**
 * `/reset#<token>` (§9.3): a new password for an account (`purpose: 'setup'` — the first one, e.g. the admin's after
 * `create-admin`), then signed in. In iOS Safari a finished reset shows the «Готово» state instead of reloading.
 */
export function ResetScreen() {
  const { status, user } = useAuth();
  const { state, retry, markInvalid } = useLinkCheck('reset', checkReset);
  const [done, setDone] = useState<{ username: string; target: string } | null>(null);
  const [completed, setCompleted] = useState(false);

  if (done) {
    return (
      <LinkDone
        title="Пароль збережено"
        username={done.username}
        text="Відкрий Home Fit з іконки й увійди з новим паролем."
        target={done.target}
      />
    );
  }
  if (state.phase === 'loading' || (status === 'checking' && !completed)) return <Splash />;
  const signedIn = status === 'authed' || user !== null;
  if (state.phase === 'invalid') {
    return (
      <LinkInvalid text={RESET_INVALID[state.reason]} askAdmin={state.reason !== 'used'} signedIn={signedIn} />
    );
  }
  const title = state.phase === 'ready' ? RESET_TITLES[state.info.purpose] : RESET_TITLES.reset;
  if (state.phase === 'error') return <LinkRetry title={title} message={state.message} onRetry={retry} />;
  const { info, token } = state;
  // Signed in as someone else on this device: sign out first. The same account goes straight to the form.
  const sameAccount = user !== null && usernameKey(user.username) === usernameKey(info.username);
  if (signedIn && !sameAccount && !completed) {
    const text = user
      ? `Це посилання для ${info.username}, а на цьому пристрої ввійдено як ${user.username}.`
      : `Це посилання для ${info.username}, а на цьому пристрої вже ввійдено в інший акаунт.`;
    return <LinkInterstitial title={title} text={text} path={LINK_PATHS.reset} />;
  }
  return (
    <ResetForm
      token={token}
      info={info}
      title={title}
      onCompleted={() => setCompleted(true)}
      onDone={setDone}
      onInvalid={markInvalid}
    />
  );
}

function ResetForm({
  token,
  info,
  title,
  onCompleted,
  onDone,
  onInvalid,
}: {
  token: string;
  info: ResetCheckResponse;
  title: string;
  onCompleted: () => void;
  onDone: (done: { username: string; target: string }) => void;
  onInvalid: (reason: LinkProblem) => void;
}) {
  const id = useId();
  const ids = {
    password: `${id}-password`,
    passwordHint: `${id}-password-hint`,
    repeat: `${id}-repeat`,
    error: `${id}-error`,
  };
  const passwordRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const safari = inIosSafari();

  const fail = (text: string, field: FieldName | null) => {
    setError({ text, field });
    setBusy(false);
    (field === 'repeat' ? repeatRef : field === 'password' ? passwordRef : null)?.current?.focus();
  };

  async function submit(): Promise<void> {
    if (password.length < PASSWORD_LIMITS.min) {
      fail(LINK_FORM_ERRORS.weakPassword, 'password');
      return;
    }
    if (repeat !== password) {
      fail(LINK_FORM_ERRORS.mismatch, 'repeat');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.resetComplete({ token, password });
      onCompleted();
      const result = await authActions.signedIn(user, { link: true, reload: !safari });
      if (result === 'cancelled') {
        onInvalid('used');
        return;
      }
      if (safari) onDone({ username: user.username, target: landingPath(user, { link: true }) });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'link_invalid') {
        onInvalid(err.reason ?? 'unknown');
        return;
      }
      fail(linkRequestErrorText(err), err instanceof ApiError && err.code === 'weak_password' ? 'password' : null);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (busy) return;
    void submit();
  }

  const errorFor = (field: FieldName) => (error?.field === field ? ids.error : undefined);

  return (
    <AuthPage title={title} subtitle={`для ${info.username}`}>
      <form className={s.card} onSubmit={handleSubmit} noValidate>
        {/* Lets iOS Keychain / password managers store the new password under this account's name. */}
        <input
          className="visually-hidden"
          type="text"
          name="username"
          autoComplete="username"
          value={info.username}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <Field id={ids.password} label="Новий пароль" hint={PASSWORD_HINT} hintId={ids.passwordHint}>
          <PasswordInput
            ref={passwordRef}
            id={ids.password}
            name="password"
            autoComplete="new-password"
            enterKeyHint="next"
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            aria-invalid={error?.field === 'password' ? true : undefined}
            aria-describedby={describedBy(ids.passwordHint, errorFor('password'))}
          />
        </Field>
        <Field id={ids.repeat} label="Повтори пароль">
          <PasswordInput
            ref={repeatRef}
            id={ids.repeat}
            name="password-repeat"
            autoComplete="new-password"
            enterKeyHint="go"
            visible={visible}
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
              setError(null);
            }}
            aria-invalid={error?.field === 'repeat' ? true : undefined}
            aria-describedby={errorFor('repeat')}
          />
        </Field>

        {error ? (
          <p id={ids.error} className={s.error} role="alert">
            {error.text}
          </p>
        ) : null}

        <button type="submit" className={s.submit} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Зберігаю…' : 'Зберегти пароль'}
        </button>
      </form>

      <p className={s.hint}>
        {info.purpose === 'setup'
          ? `Посилання одноразове, діє до ${untilDateTime(info.expiresAt)}.`
          : RESET_SIGN_OUT_NOTE}
      </p>
      {safari ? <CopyLinkNote kind="reset" token={token} /> : null}
    </AuthPage>
  );
}
