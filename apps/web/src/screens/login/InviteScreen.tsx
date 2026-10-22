import {
  LINK_PATHS,
  PASSWORD_LIMITS,
  usernameProblem,
  type InviteCheckResponse,
  type LinkProblem,
} from '@legko/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { authActions, landingPath, useAuth } from '../../auth/auth';
import { Splash } from '../../auth/Splash';
import { api, ApiError } from '../../lib/api';
import { describedBy, Field, PasswordInput, UsernameInput } from './fields';
import {
  AuthPage,
  CopyLinkNote,
  inIosSafari,
  LinkDone,
  LinkInterstitial,
  LinkInvalid,
  LinkRetry,
} from './LinkParts';
import {
  INVITE_INVALID,
  LINK_FORM_ERRORS,
  linkRequestErrorText,
  PASSWORD_HINT,
  untilDate,
  USERNAME_HINT,
} from './loginErrors';
import s from './LoginScreen.module.css';
import { useLinkCheck } from './useLinkCheck';

export const INVITE_TITLE = 'Запрошення в Легко';
const INVITE_SUBTITLE = 'Обери імʼя і пароль — і можна починати';

const checkInvite = (token: string): Promise<InviteCheckResponse> => api.inviteCheck(token);

type FieldName = 'username' | 'password' | 'repeat';
interface FormError {
  text: string;
  field: FieldName | null;
}

/**
 * `/invite#<token>` (§9.2): choose a username and a password → signed in → «Перші кроки». The only way to get an
 * account. In iOS Safari a finished invite shows the «Готово» state (name + install steps) instead of reloading.
 */
export function InviteScreen() {
  const { status, user } = useAuth();
  const { state, retry, markInvalid } = useLinkCheck('invite', checkInvite);
  const [done, setDone] = useState<{ username: string; target: string } | null>(null);
  const [accepted, setAccepted] = useState(false);

  if (done) {
    return (
      <LinkDone
        title="Акаунт створено"
        username={done.username}
        text="Нагадування приходять у застосунок на початковому екрані. Додай Легко туди й один раз увійди з цим імʼям і паролем."
        installSteps
        target={done.target}
      />
    );
  }
  if (state.phase === 'loading' || (status === 'checking' && !accepted)) return <Splash />;
  const signedIn = status === 'authed' || user !== null;
  if (state.phase === 'invalid') {
    return (
      <LinkInvalid
        text={INVITE_INVALID[state.reason]}
        askAdmin={state.reason !== 'used'}
        signedIn={signedIn}
      />
    );
  }
  if (state.phase === 'error') return <LinkRetry title={INVITE_TITLE} message={state.message} onRetry={retry} />;
  if (signedIn && !accepted) {
    const text = user
      ? `На цьому пристрої вже ввійдено як ${user.username}. Щоб створити новий акаунт, спершу вийди.`
      : 'На цьому пристрої вже ввійдено. Щоб створити новий акаунт, спершу вийди.';
    return <LinkInterstitial title={INVITE_TITLE} text={text} path={LINK_PATHS.invite} />;
  }
  return (
    <InviteForm
      token={state.token}
      expiresAt={state.info.expiresAt}
      onAccepted={() => setAccepted(true)}
      onDone={setDone}
      onInvalid={markInvalid}
    />
  );
}

function InviteForm({
  token,
  expiresAt,
  onAccepted,
  onDone,
  onInvalid,
}: {
  token: string;
  expiresAt: number;
  onAccepted: () => void;
  onDone: (done: { username: string; target: string }) => void;
  onInvalid: (reason: LinkProblem) => void;
}) {
  const id = useId();
  const ids = {
    username: `${id}-username`,
    usernameHint: `${id}-username-hint`,
    password: `${id}-password`,
    passwordHint: `${id}-password-hint`,
    repeat: `${id}-repeat`,
    error: `${id}-error`,
  };
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const safari = inIosSafari();

  const fail = (text: string, field: FieldName | null) => {
    setError({ text, field });
    setBusy(false);
    const ref = field === 'username' ? usernameRef : field === 'password' ? passwordRef : field ? repeatRef : null;
    ref?.current?.focus();
  };

  async function submit(): Promise<void> {
    const name = username.trim();
    const problem = usernameProblem(name);
    if (problem) {
      fail(problem === 'reserved' ? LINK_FORM_ERRORS.usernameReserved : LINK_FORM_ERRORS.invalidUsername, 'username');
      return;
    }
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
      const { user } = await api.inviteAccept({ token, username: name, password });
      onAccepted();
      const result = await authActions.signedIn(user, { link: true, reload: !safari });
      if (result === 'cancelled') {
        // The account exists now; the new session was ended because the device kept someone's unsent changes.
        onInvalid('used');
        return;
      }
      if (safari) onDone({ username: user.username, target: landingPath(user, { link: true }) });
      // Everywhere else the page reloads into the app.
    } catch (err) {
      if (err instanceof ApiError && err.code === 'link_invalid') {
        onInvalid(err.reason ?? 'unknown');
        return;
      }
      const field: FieldName | null =
        err instanceof ApiError && (err.code === 'username_taken' || err.code === 'invalid_username')
          ? 'username'
          : err instanceof ApiError && err.code === 'weak_password'
            ? 'password'
            : null;
      fail(linkRequestErrorText(err), field);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (busy) return;
    void submit();
  }

  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError(null);
  };
  const errorFor = (field: FieldName) => (error?.field === field ? ids.error : undefined);

  return (
    <AuthPage title={INVITE_TITLE} subtitle={INVITE_SUBTITLE}>
      <form className={s.card} onSubmit={handleSubmit} noValidate>
        <Field id={ids.username} label="Імʼя користувача" hint={USERNAME_HINT} hintId={ids.usernameHint}>
          <UsernameInput
            ref={usernameRef}
            id={ids.username}
            autoComplete="username"
            enterKeyHint="next"
            value={username}
            onChange={(e) => change(setUsername)(e.target.value)}
            aria-invalid={error?.field === 'username' ? true : undefined}
            aria-describedby={describedBy(ids.usernameHint, errorFor('username'))}
          />
        </Field>
        <Field id={ids.password} label="Пароль" hint={PASSWORD_HINT} hintId={ids.passwordHint}>
          <PasswordInput
            ref={passwordRef}
            id={ids.password}
            name="password"
            autoComplete="new-password"
            enterKeyHint="next"
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
            value={password}
            onChange={(e) => change(setPassword)(e.target.value)}
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
            onChange={(e) => change(setRepeat)(e.target.value)}
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
          {busy ? 'Створюю…' : 'Створити акаунт'}
        </button>
      </form>

      <p className={s.hint}>Посилання одноразове, діє до {untilDate(expiresAt)}.</p>
      {safari ? <CopyLinkNote kind="invite" token={token} /> : null}
    </AuthPage>
  );
}
