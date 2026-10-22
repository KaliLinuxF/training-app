import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { PASSWORD_LIMITS, type FoodStatusResponse, type SessionUser } from '@legko/shared';
import { authActions, useCurrentUser } from '@/auth/auth';
import { api } from '@/lib/api';
import { useSyncState } from '@/store/data';
import { ui } from '@/store/ui';
import { Avatar, Button, Card, CardHeader, ListGroup } from '@/ui';
import { useRefocus } from '../focus';
import f from '../forms.module.css';
import { LogoutRow } from '../LogoutRow';
import {
  ACCOUNT_COPY,
  aiLeftText,
  avatarLetter,
  checkPasswordForm,
  checkRenameForm,
  passwordErrorFrom,
  profileLine,
  provenanceLine,
  renameErrorFrom,
  type FormError,
  type PasswordField,
  type RenameField,
} from './accountModel';
import s from './AccountPage.module.css';

export interface AccountPageProps {
  /** Level of the cards' titles: `h2` on the phone sub-page, `h3` in the desktop pane. */
  headingLevel: 'h2' | 'h3';
}

/**
 * «Акаунт» (`/settings/account`, docs/multi-user.md §9.5): who is signed in, the password (with where it came from,
 * D28), the login name, today's AI estimates and «Вийти» (moved here from the list, D30). Every change is online
 * only (D20): offline the buttons are disabled and say «Потрібен інтернет».
 */
export function AccountPage({ headingLevel }: AccountPageProps) {
  const user = useCurrentUser();
  const online = useSyncState().online;
  return (
    <>
      {user ? (
        <>
          <ProfileCard user={user} />
          <PasswordCard user={user} online={online} headingLevel={headingLevel} />
          <UsernameCard user={user} online={online} headingLevel={headingLevel} />
        </>
      ) : (
        <Card as="section" aria-label={ACCOUNT_COPY.profile}>
          <p className={f.status} role="status">
            {ACCOUNT_COPY.loading}
          </p>
        </Card>
      )}
      <AiCard headingLevel={headingLevel} />
      <ListGroup full>
        <LogoutRow />
      </ListGroup>
    </>
  );
}

function ProfileCard({ user }: { user: SessionUser }) {
  return (
    <Card as="section" aria-label={ACCOUNT_COPY.profile} row gap={14}>
      <Avatar letter={avatarLetter(user.username)} />
      <div className={s.profileText}>
        <p className={s.name}>{user.username}</p>
        <p className={s.since}>{profileLine(user)}</p>
        {user.role === 'user' && <p className={s.visibility}>{ACCOUNT_COPY.adminSees}</p>}
      </div>
    </Card>
  );
}

/** Ids of a form's fields, errors and hints. */
function useFormIds<F extends string>(fields: readonly F[]) {
  const id = useId();
  const ids = Object.fromEntries(fields.map((field) => [field, `${id}${field}`])) as Record<F, string>;
  return { ...ids, error: `${id}error`, hint: `${id}hint`, title: `${id}title`, offline: `${id}offline` };
}

const PASSWORD_FIELDS = ['current', 'next', 'repeat'] as const;

function PasswordCard({
  user,
  online,
  headingLevel,
}: { user: SessionUser; online: boolean } & AccountPageProps) {
  const ids = useFormIds(PASSWORD_FIELDS);
  const [draft, setDraft] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError<PasswordField> | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const refocus = useRefocus();
  const provenance = provenanceLine(user.passwordChange);
  /** «Змінити пароль» was disabled while it worked: the focus goes back to it (to the card title while offline). */
  const backToSubmit = () => refocus([submitRef, ids.title]);

  const fail = (problem: FormError<PasswordField>) => {
    setError(problem);
    // A whole-form refusal (rate limit, network) has no field to put the focus on.
    if (problem.field === null) backToSubmit();
    else ({ current: currentRef, next: nextRef, repeat: repeatRef })[problem.field].current?.focus();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !online) return;
    const problem = checkPasswordForm(draft);
    if (problem) {
      fail(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.account.changePassword({ currentPassword: draft.current, newPassword: draft.next });
      setDraft({ current: '', next: '', repeat: '' });
      ui.flash(ACCOUNT_COPY.passwordChanged);
      backToSubmit();
      // The server rotated this device's cookie (D26); the provenance line now says «Пароль змінено …».
      void authActions.refreshUser();
    } catch (err) {
      fail(passwordErrorFrom(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    name: PasswordField,
    ref: RefObject<HTMLInputElement | null>,
    label: string,
    autoComplete: string,
    hint?: string,
  ) => {
    const invalid = error?.field === name;
    const describedBy = [invalid && ids.error, hint && ids.hint].filter(Boolean).join(' ') || undefined;
    return (
      <div className={f.field}>
        <label className={f.label} htmlFor={ids[name]}>
          {label}
        </label>
        <input
          ref={ref}
          id={ids[name]}
          className={f.input}
          type="password"
          name={
            name === 'current' ? 'current-password' : name === 'next' ? 'new-password' : 'repeat-password'
          }
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={PASSWORD_LIMITS.max}
          value={draft[name]}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            const value = e.target.value;
            setDraft((d) => ({ ...d, [name]: value }));
            if (error) setError(null);
          }}
        />
        {hint && (
          <p id={ids.hint} className={f.hint}>
            {hint}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card as="section" aria-labelledby={ids.title}>
      <CardHeader
        size="sm"
        as={headingLevel}
        title={ACCOUNT_COPY.passwordTitle}
        titleId={ids.title}
        className={f.focusSpot}
      />
      <form className={f.form} onSubmit={(e) => void submit(e)} noValidate>
        {/* Lets iOS Keychain / password managers file the new password under this account's name. */}
        <input
          className="visually-hidden"
          type="text"
          name="username"
          autoComplete="username"
          value={user.username}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        {provenance && <p className={s.provenance}>{provenance}</p>}
        {field('current', currentRef, ACCOUNT_COPY.currentPassword, 'current-password')}
        {field('next', nextRef, ACCOUNT_COPY.newPassword, 'new-password', ACCOUNT_COPY.passwordHint)}
        {field('repeat', repeatRef, ACCOUNT_COPY.repeatPassword, 'new-password')}
        {error && (
          <p id={ids.error} className={f.error} role="alert">
            {error.text}
          </p>
        )}
        <div className={f.actions}>
          <Button
            ref={submitRef}
            type="submit"
            size="lg"
            fullWidth
            disabled={busy || !online}
            aria-describedby={online ? undefined : ids.offline}
          >
            {busy ? ACCOUNT_COPY.changingPassword : ACCOUNT_COPY.changePassword}
          </Button>
          {!online && <OfflineNote id={ids.offline} />}
        </div>
        <p className={f.note}>{ACCOUNT_COPY.otherDevices}</p>
      </form>
    </Card>
  );
}

const RENAME_FIELDS = ['username', 'password'] as const;

function UsernameCard({
  user,
  online,
  headingLevel,
}: { user: SessionUser; online: boolean } & AccountPageProps) {
  const ids = useFormIds(RENAME_FIELDS);
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ username: user.username, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError<RenameField> | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const refocus = useRefocus();
  /** Focus the name field once the form has rendered (after «Змінити»). */
  const focusName = useRef(false);

  useEffect(() => {
    if (!editing || !focusName.current) return;
    focusName.current = false;
    nameRef.current?.focus();
  }, [editing]);

  const open = () => {
    setDraft({ username: user.username, password: '' });
    setError(null);
    focusName.current = true;
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
    toggleRef.current?.focus();
  };

  const fail = (problem: FormError<RenameField>) => {
    setError(problem);
    if (problem.field === 'username') nameRef.current?.focus();
    else if (problem.field === 'password') passwordRef.current?.focus();
    // A whole-form refusal (rate limit, network): back to «Зберегти імʼя», disabled while it worked.
    else refocus([saveRef, toggleRef]);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !online) return;
    const problem = checkRenameForm(draft, user.username);
    if (problem === 'unchanged') {
      close();
      return;
    }
    if (problem) {
      fail(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.account.rename({ username: draft.username.trim(), password: draft.password });
      authActions.updateUser(res.user);
      ui.flash(ACCOUNT_COPY.usernameChanged);
      close();
    } catch (err) {
      fail(renameErrorFrom(err));
    } finally {
      setBusy(false);
    }
  };

  const invalid = (name: RenameField) => error?.field === name;
  const describe = (name: RenameField, ...extra: (string | false)[]) =>
    [invalid(name) && ids.error, ...extra].filter(Boolean).join(' ') || undefined;

  return (
    <Card as="section" aria-labelledby={ids.title}>
      <CardHeader size="sm" as={headingLevel} title={ACCOUNT_COPY.usernameTitle} titleId={ids.title} />
      <div className={s.viewRow}>
        <span className={s.current}>{user.username}</span>
        <Button
          ref={toggleRef}
          variant="ghost"
          className={s.edit}
          aria-expanded={editing}
          aria-controls={editing ? formId : undefined}
          onClick={editing ? close : open}
        >
          {ACCOUNT_COPY.edit}
        </Button>
      </div>
      {editing && (
        <form id={formId} className={f.form} onSubmit={(e) => void submit(e)} noValidate>
          <div className={f.field}>
            <label className={f.label} htmlFor={ids.username}>
              {ACCOUNT_COPY.newUsername}
            </label>
            <input
              ref={nameRef}
              id={ids.username}
              className={f.input}
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              value={draft.username}
              aria-invalid={invalid('username') || undefined}
              aria-describedby={describe('username', ids.hint)}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((d) => ({ ...d, username: value }));
                if (error) setError(null);
              }}
            />
            <p id={ids.hint} className={f.hint}>
              {ACCOUNT_COPY.usernameHint}
            </p>
          </div>
          <div className={f.field}>
            <label className={f.label} htmlFor={ids.password}>
              {ACCOUNT_COPY.password}
            </label>
            <input
              ref={passwordRef}
              id={ids.password}
              className={f.input}
              type="password"
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={PASSWORD_LIMITS.max}
              value={draft.password}
              aria-invalid={invalid('password') || undefined}
              aria-describedby={describe('password')}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((d) => ({ ...d, password: value }));
                if (error) setError(null);
              }}
            />
          </div>
          {error && (
            <p id={ids.error} className={f.error} role="alert">
              {error.text}
            </p>
          )}
          <div className={f.pair}>
            <Button
              ref={saveRef}
              type="submit"
              size="lg"
              disabled={busy || !online}
              aria-describedby={online ? undefined : ids.offline}
            >
              {busy ? ACCOUNT_COPY.savingUsername : ACCOUNT_COPY.saveUsername}
            </Button>
            <Button variant="outline" size="lg" onClick={close}>
              {ACCOUNT_COPY.cancel}
            </Button>
          </div>
          {!online && <OfflineNote id={ids.offline} />}
          <p className={f.note}>{ACCOUNT_COPY.loginWithNew}</p>
        </form>
      )}
    </Card>
  );
}

/** Today's AI estimates of this account (only while AI is on for it). */
function AiCard({ headingLevel }: AccountPageProps) {
  const titleId = useId();
  const [status, setStatus] = useState<FoodStatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.foodStatus();
        if (alive) setStatus(res);
      } catch {
        // Offline / an older server: the card just stays away.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!status?.enabled) return null;
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader size="sm" as={headingLevel} title={ACCOUNT_COPY.aiTitle} titleId={titleId} />
      <p className={s.ai}>{aiLeftText(status)}</p>
    </Card>
  );
}

function OfflineNote({ id }: { id: string }) {
  return (
    <p id={id} className={f.note}>
      {ACCOUNT_COPY.offline}
    </p>
  );
}
