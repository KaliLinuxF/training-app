import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AdminUser, LinkResponse, UserRole } from '@legko/shared';
import { authActions } from '@/auth/auth';
import { api } from '@/lib/api';
import { ui } from '@/store/ui';
import { Button, cx, KeyValueRow, Segmented, Sheet, Stepper, Switch, useRetained } from '@/ui';
import { focusedControl, useRefocus, type FocusCandidate } from '../focus';
import f from '../forms.module.css';
import { isForbidden, noteForbidden } from './adminOverview';
import { LinkCard } from './LinkCard';
import {
  adminErrorText,
  AI_LIMIT_STEPS,
  defaultLimitText,
  deletedToast,
  deleteNameMatches,
  deletePrompt,
  deleteTitle,
  disableConfirm,
  isLastUsableAdmin,
  ROLE_LABELS,
  roleConfirm,
  SHEET_COPY,
  stepLimit,
  userFacts,
  USERS_COPY,
  type AdminAction,
} from './usersModel';
import s from './UserSheet.module.css';

export interface UserSheetProps {
  /** The account shown; null = closed. */
  user: AdminUser | null;
  /** Every account (for the last-admin rule). */
  users: readonly AdminUser[];
  /** The per-user default limit («Як у всіх: 40 на день»). */
  defaultLimit: number;
  online: boolean;
  onClose: () => void;
  /** Something changed on the server: reload the overview. */
  onChanged: () => Promise<void>;
  /** The account was deleted, the sheet closed and the list reloaded (its row is gone: the page takes the focus). */
  onDeleted: () => void;
}

/** What `run` resolves to when the request failed (its error is already on screen). */
const FAILED: unique symbol = Symbol('failed');

/**
 * Where the focus goes back after an action started now: the control it was started from (disabled while the
 * request runs, so the browser dropped the focus), else the sheet itself.
 */
function returnPoint(): [control: HTMLElement | null, dialog: HTMLElement | null] {
  const control = focusedControl();
  return [control, control?.closest<HTMLElement>('[role="dialog"]') ?? null];
}

const ROLE_OPTIONS: readonly { value: UserRole; label: string }[] = [
  { value: 'user', label: ROLE_LABELS.user },
  { value: 'admin', label: ROLE_LABELS.admin },
];

/**
 * One account in «Користувачі» (docs/multi-user.md §9.6): facts, role, own AI limit, a reset link, disable / enable
 * and delete (a typed-name confirm panel that Escape / ✕ leave first). A phone bottom sheet, the standard centred
 * modal on desktop (`Sheet` decides). Never any of the person's records.
 */
export function UserSheet({
  user,
  users,
  defaultLimit,
  online,
  onClose,
  onChanged,
  onDeleted,
}: UserSheetProps) {
  const shown = useRetained(user);
  const [mode, setMode] = useState<'details' | 'delete'>('details');
  const [modeFor, setModeFor] = useState<string | null>(null);
  // Another account (or the same one opened again) starts on its details.
  if ((user?.id ?? null) !== modeFor && user !== null) {
    setModeFor(user.id);
    setMode('details');
  }

  const close = () => {
    setModeFor(null);
    onClose();
  };

  return (
    <Sheet
      open={user !== null}
      onClose={mode === 'delete' ? () => setMode('details') : close}
      heading={shown?.username ?? ''}
    >
      {shown && (
        <UserSheetBody
          key={shown.id}
          user={shown}
          users={users}
          defaultLimit={defaultLimit}
          online={online}
          mode={mode}
          setMode={setMode}
          onClose={close}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      )}
    </Sheet>
  );
}

interface BodyProps extends Omit<UserSheetProps, 'user' | 'onClose'> {
  user: AdminUser;
  mode: 'details' | 'delete';
  setMode: (mode: 'details' | 'delete') => void;
  onClose: () => void;
}

function UserSheetBody({
  user,
  users,
  defaultLimit,
  online,
  mode,
  setMode,
  onClose,
  onChanged,
  onDeleted,
}: BodyProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkResponse | null>(null);
  const deleteOpenerRef = useRef<HTMLButtonElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const wasDeleting = useRef(false);
  const limitSwitchId = useId();
  const refocus = useRefocus();

  // Back from the delete panel: the focus returns to «Видалити акаунт…».
  useEffect(() => {
    if (mode === 'delete') {
      wasDeleting.current = true;
      return;
    }
    if (wasDeleting.current) {
      wasDeleting.current = false;
      deleteOpenerRef.current?.focus();
    }
  }, [mode]);

  /**
   * Runs one admin request: busy while it runs (every control is disabled, so the focus is dropped), its error shown
   * in the sheet (and the overview reloaded: the account may have changed meanwhile) with the focus back at `back`,
   * a 403 leaves the page. Resolves to the answer, or `FAILED`.
   */
  const run = async <T,>(
    action: AdminAction,
    request: () => Promise<T>,
    back: readonly FocusCandidate[],
  ): Promise<T | typeof FAILED> => {
    setBusy(true);
    setError(null);
    try {
      return await request();
    } catch (err) {
      if (isForbidden(err)) {
        onClose();
        noteForbidden();
        return FAILED;
      }
      setError(adminErrorText(err, action));
      refocus(back);
      void onChanged();
      return FAILED;
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (role: UserRole) => {
    if (role === user.role) return;
    const back = returnPoint();
    if (!(await ui.confirm(roleConfirm(user.username, role, user.self)))) return;
    if ((await run('user', () => api.admin.setRole({ userId: user.id, role }), back)) === FAILED) return;
    ui.flash(SHEET_COPY.roleChanged);
    if (user.self && role === 'user') {
      // No longer an admin: «Користувачі» goes away (the settings screen redirects once the role is known).
      onClose();
      await authActions.refreshUser();
      return;
    }
    await onChanged();
    refocus(back);
  };

  const toggleDisabled = async () => {
    const disable = user.status !== 'disabled';
    const back = returnPoint();
    if (disable && !(await ui.confirm(disableConfirm(user.username)))) return;
    const done = await run('user', () => api.admin.setDisabled({ userId: user.id, disabled: disable }), back);
    if (done === FAILED) return;
    // A disabled account's pending reset links are revoked by the server.
    if (disable) setLink(null);
    ui.flash(disable ? SHEET_COPY.disabled : SHEET_COPY.enabled);
    await onChanged();
    // The same button, now «Увімкнути акаунт» / «Вимкнути акаунт».
    refocus(back);
  };

  const makeResetLink = async () => {
    // Made: the link card takes the focus itself (its title).
    const created = await run('user', () => api.admin.resetLink({ userId: user.id }), returnPoint());
    if (created !== FAILED) setLink(created);
  };

  if (mode === 'delete') {
    return (
      <DeletePanel
        user={user}
        busy={busy}
        online={online}
        error={error}
        onCancel={() => {
          setError(null);
          setMode('details');
        }}
        onDelete={async (confirmUsername) => {
          const done = await run(
            'delete',
            () => api.admin.deleteUser({ userId: user.id, confirmUsername }),
            returnPoint(),
          );
          if (done === FAILED) return;
          ui.flash(deletedToast(user.username));
          onClose();
          await onChanged();
          onDeleted();
        }}
      />
    );
  }

  const facts = userFacts(user);
  const lastAdmin = isLastUsableAdmin(user, users);
  const actionsOff = busy || !online;

  return (
    <div className={s.body}>
      <div className={s.facts}>
        <p className={s.fact}>{facts.since}</p>
        <p className={s.fact}>{facts.activity}</p>
        <p className={s.fact}>{facts.ai}</p>
      </div>

      <RoleControl
        role={user.role}
        locked={lastAdmin}
        disabled={actionsOff}
        onChange={(role) => void changeRole(role)}
      />

      <AiLimitControl
        user={user}
        defaultLimit={defaultLimit}
        disabled={actionsOff}
        switchId={limitSwitchId}
        onSave={async (limit) => {
          const [control, dialog] = returnPoint();
          const done = await run('user', () => api.admin.setUserAiLimit({ userId: user.id, limit }), [
            control,
            dialog,
          ]);
          if (done === FAILED) return;
          ui.flash(USERS_COPY.saved);
          await onChanged();
          // «Зберегти ліміт» goes away once saved: the switch above it takes the focus.
          refocus([control, limitSwitchId, dialog]);
        }}
      />

      <div className={s.actions}>
        {user.status === 'disabled' ? (
          <p className={f.note}>{SHEET_COPY.enableFirst}</p>
        ) : link ? (
          <LinkCard
            purpose={user.status === 'pending' ? 'setup' : 'reset'}
            path={link.path}
            expiresAt={link.expiresAt}
            headingLevel="h3"
            onDone={() => {
              setLink(null);
              // The button is back on the next render: focus it once it is there.
              requestAnimationFrame(() => resetButtonRef.current?.focus());
            }}
          />
        ) : (
          <Button
            ref={resetButtonRef}
            variant="outline"
            size="lg"
            fullWidth
            disabled={actionsOff}
            onClick={() => void makeResetLink()}
          >
            {user.status === 'pending' ? SHEET_COPY.setupLink : SHEET_COPY.resetLink}
          </Button>
        )}
        {!user.self && (
          <>
            <Button
              variant="outline"
              size="lg"
              fullWidth
              disabled={actionsOff}
              onClick={() => void toggleDisabled()}
            >
              {user.status === 'disabled' ? SHEET_COPY.enable : SHEET_COPY.disable}
            </Button>
            <Button
              ref={deleteOpenerRef}
              variant="ghost"
              className={cx(f.dangerGhost, s.deleteOpen)}
              disabled={actionsOff}
              onClick={() => {
                setError(null);
                setMode('delete');
              }}
            >
              {SHEET_COPY.deleteOpen}
            </Button>
          </>
        )}
      </div>

      {error && (
        <p className={f.error} role="alert">
          {error}
        </p>
      )}
      {!online && <p className={f.note}>Потрібен інтернет</p>}
    </div>
  );
}

function RoleControl({
  role,
  locked,
  disabled,
  onChange,
}: {
  role: UserRole;
  locked: boolean;
  disabled: boolean;
  onChange: (role: UserRole) => void;
}) {
  // The fieldset only disables the radios (the kit's Segmented has no `disabled`); the radiogroup itself is
  // named «Роль», so the visible label above it is not read twice.
  return (
    <div className={s.role}>
      <p className={s.label} aria-hidden="true">
        {SHEET_COPY.role}
      </p>
      <fieldset
        role="presentation"
        className={cx(s.roleSet, locked && s.locked)}
        disabled={locked || disabled}
      >
        <Segmented
          options={ROLE_OPTIONS}
          value={role}
          aria-label={SHEET_COPY.role}
          onChange={(next) => {
            if (!locked && !disabled) onChange(next);
          }}
        />
      </fieldset>
      {locked && <p className={f.note}>{SHEET_COPY.lastAdminHint}</p>}
    </div>
  );
}

function AiLimitControl({
  user,
  defaultLimit,
  disabled,
  switchId,
  onSave,
}: {
  user: AdminUser;
  defaultLimit: number;
  disabled: boolean;
  /** id of the switch (the focus goes there once «Зберегти ліміт» is gone). */
  switchId: string;
  onSave: (limit: number | null) => Promise<void>;
}) {
  const labelId = useId();
  const subId = useId();
  const saved = user.ai.customLimit;
  const [custom, setCustom] = useState(saved !== null);
  const [limit, setLimit] = useState(saved ?? user.ai.limit);
  const [shownSaved, setShownSaved] = useState(saved);
  // Saved here or elsewhere: the controls follow the server.
  if (saved !== shownSaved) {
    setShownSaved(saved);
    setCustom(saved !== null);
    setLimit(saved ?? user.ai.limit);
  }
  const target = custom ? limit : null;
  const changed = target !== saved;
  const range = AI_LIMIT_STEPS.perUser;

  return (
    <div className={s.ai}>
      <div className={s.switchRow}>
        <div className={s.switchText}>
          <span id={labelId} className={s.switchLabel}>
            {SHEET_COPY.customLimit}
          </span>
          <span id={subId} className={s.switchSub}>
            {custom
              ? limit === 0
                ? SHEET_COPY.limitOff
                : `${limit} на день`
              : defaultLimitText(defaultLimit)}
          </span>
        </div>
        <Switch
          id={switchId}
          checked={custom}
          onChange={setCustom}
          aria-labelledby={labelId}
          aria-describedby={subId}
          disabled={disabled}
        />
      </div>
      {custom && (
        <KeyValueRow
          variant="plain"
          className={s.limitRow}
          label={SHEET_COPY.dailyLimit}
          value={
            <Stepper
              aria-label={SHEET_COPY.dailyLimit}
              className={s.stepper}
              value={String(limit)}
              decrementLabel="Зменшити ліміт"
              incrementLabel="Збільшити ліміт"
              canDecrement={!disabled && limit > range.min}
              canIncrement={!disabled && limit < range.max}
              onDecrement={() => setLimit((v) => stepLimit(v, -1, range))}
              onIncrement={() => setLimit((v) => stepLimit(v, 1, range))}
            />
          }
        />
      )}
      {changed && (
        <Button variant="solid" fullWidth disabled={disabled} onClick={() => void onSave(target)}>
          {SHEET_COPY.saveLimit}
        </Button>
      )}
    </div>
  );
}

function DeletePanel({
  user,
  busy,
  online,
  error,
  onCancel,
  onDelete,
}: {
  user: AdminUser;
  busy: boolean;
  online: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete: (confirmUsername: string) => Promise<void>;
}) {
  const titleId = useId();
  const promptId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const matches = deleteNameMatches(typed, user.username);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!matches || busy || !online) return;
    void onDelete(typed.trim());
  };

  return (
    <form className={s.body} onSubmit={submit} aria-labelledby={titleId} noValidate>
      <h3 id={titleId} className={s.deleteTitle}>
        {deleteTitle(user.username)}
      </h3>
      <p className={s.deleteBody}>{SHEET_COPY.deleteBody}</p>
      <div className={f.field}>
        <p id={promptId} className={s.prompt}>
          {deletePrompt(user.username)}
        </p>
        <input
          ref={inputRef}
          className={cx(f.input, f.onPaper)}
          type="text"
          name="confirm-username"
          aria-label={SHEET_COPY.deleteInput}
          aria-describedby={promptId}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      {error && (
        <p className={f.error} role="alert">
          {error}
        </p>
      )}
      <div className={f.actions}>
        <Button type="submit" size="lg" fullWidth className={f.danger} disabled={!matches || busy || !online}>
          {SHEET_COPY.deleteConfirm}
        </Button>
        <Button variant="outline" size="lg" fullWidth onClick={onCancel}>
          {SHEET_COPY.cancel}
        </Button>
      </div>
      {!online && <p className={f.note}>Потрібен інтернет</p>}
    </form>
  );
}
