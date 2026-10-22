import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Redirect } from 'wouter';
import {
  f0,
  INVITE_NOTE_MAX,
  type AdminInvite,
  type AdminOverview,
  type AdminUser,
  type AiLimits,
  type InviteCreatedResponse,
} from '@legko/shared';
import { useCurrentUser } from '@/auth/auth';
import { api } from '@/lib/api';
import { useSyncState } from '@/store/data';
import { ui } from '@/store/ui';
import {
  Button,
  Card,
  CardHeader,
  cx,
  KeyValueRow,
  ListGroup,
  ListRow,
  Pill,
  SectionTitle,
  Stepper,
} from '@/ui';
import { useRefocus } from '../focus';
import f from '../forms.module.css';
import { SETTINGS_ROOT } from '../listModel';
import { isForbidden, noteForbidden, useAdminOverview, type OverviewStatus } from './adminOverview';
import { LinkCard } from './LinkCard';
import { UserSheet } from './UserSheet';
import {
  adminErrorText,
  AI_LIMIT_STEPS,
  aiTodayLine,
  inviteSub,
  inviteTitle,
  REVOKE_CONFIRM,
  stepLimit,
  userPills,
  userRowSub,
  USERS_COPY,
} from './usersModel';
import s from './UsersPage.module.css';

export interface UsersPageProps {
  /** Level of the cards' titles: `h2` on the phone sub-page, `h3` in the desktop pane. */
  headingLevel: 'h2' | 'h3';
}

const ERROR_MS = 3200;

/** The «Скасувати» of the pending invite at `index` (the last one when fewer are left), once the list re-rendered. */
function revokeButtonAt(invitesTitleId: string, index: number): HTMLElement | null {
  const group = document.getElementById(invitesTitleId)?.closest('section');
  const buttons = group?.querySelectorAll<HTMLElement>('[data-revoke]') ?? [];
  return buttons[Math.min(index, buttons.length - 1)] ?? null;
}

/** A section title above a list: the page's 18/700 on the phone, a list caption in the desktop pane. */
const groupTitleClass = (headingLevel: UsersPageProps['headingLevel']) =>
  cx(headingLevel === 'h3' && s.paneGroupTitle, f.focusSpot);

/**
 * «Користувачі» (`/settings/users`, admins only; docs/multi-user.md §9.6): invite a person, the pending invites, the
 * accounts (a row opens the user sheet) and the AI limits. Everything comes from the admin API — never anyone's
 * records — and every change is online only (D20). A 403 means the role changed elsewhere: back to the list.
 */
export function UsersPage({ headingLevel }: UsersPageProps) {
  const me = useCurrentUser();
  const online = useSyncState().online;
  const { overview, status, failed, forbidden, reload } = useAdminOverview(me?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const invitesTitleId = useId();
  const accountsTitleId = useId();
  // The page outlives the rows a change removes: it puts the focus back once the reloaded list is on screen.
  const refocus = useRefocus();

  // Back online after a failed load: try again by itself.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && (failed || status === 'error')) void reload();
    wasOnline.current = online;
  }, [online, failed, status, reload]);

  if (forbidden) return <Redirect to={SETTINGS_ROOT} replace />;

  const selected = overview?.users.find((u) => u.id === openId) ?? null;

  return (
    <>
      {!online && overview !== null && (
        <Card as="section" aria-label={USERS_COPY.offline}>
          <p className={f.status} role="status">
            {USERS_COPY.offline}
          </p>
        </Card>
      )}
      <InviteCard online={online} headingLevel={headingLevel} onCreated={reload} />
      {overview === null ? (
        <OverviewState status={status} online={online} onRetry={() => void reload()} />
      ) : (
        <>
          {overview.invites.length > 0 && (
            <InvitesGroup
              titleId={invitesTitleId}
              invites={overview.invites}
              online={online}
              headingLevel={headingLevel}
              onChanged={reload}
              onRevoked={(index) =>
                // The next invite's «Скасувати» (the previous one after the last), else the titles.
                refocus([() => revokeButtonAt(invitesTitleId, index), invitesTitleId, accountsTitleId])
              }
            />
          )}
          <AccountsGroup
            titleId={accountsTitleId}
            users={overview.users}
            headingLevel={headingLevel}
            onOpen={setOpenId}
          />
          <AiLimitsCard
            limits={overview.limits}
            aiToday={overview.aiToday}
            online={online}
            headingLevel={headingLevel}
            onSaved={reload}
          />
        </>
      )}
      <UserSheet
        user={selected}
        users={overview?.users ?? []}
        defaultLimit={overview?.limits.perUser ?? 0}
        online={online}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        // The row that opened the sheet is gone: «Акаунти · N», even from inside the closing sheet.
        onDeleted={() => refocus([accountsTitleId], { always: true })}
      />
    </>
  );
}

/** «Завантажую…», «Не вдалося завантажити» + «Спробувати ще раз», or «Потрібен інтернет». */
function OverviewState({
  status,
  online,
  onRetry,
}: {
  status: OverviewStatus;
  online: boolean;
  onRetry: () => void;
}) {
  if (!online) {
    return (
      <Card as="section" aria-label={USERS_COPY.offline}>
        <p className={f.status} role="status">
          {USERS_COPY.offline}
        </p>
      </Card>
    );
  }
  if (status === 'error') {
    return (
      <Card as="section" aria-label={USERS_COPY.loadFailed}>
        <p className={f.status} role="alert">
          {USERS_COPY.loadFailed}
        </p>
        <Button variant="outline" fullWidth onClick={onRetry}>
          {USERS_COPY.retry}
        </Button>
      </Card>
    );
  }
  return (
    <Card as="section" aria-label={USERS_COPY.loading}>
      <p className={f.status} role="status">
        {USERS_COPY.loading}
      </p>
    </Card>
  );
}

function InviteCard({
  online,
  headingLevel,
  onCreated,
}: {
  online: boolean;
  onCreated: () => Promise<void>;
} & UsersPageProps) {
  const ids = { title: useId(), note: useId(), hint: useId(), error: useId() };
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteCreatedResponse | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const refocus = useRefocus();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.createInvite({ note: note.trim() });
      // The link card takes the focus itself (its title).
      setCreated(res);
      setNote('');
      void onCreated();
    } catch (err) {
      if (isForbidden(err)) {
        noteForbidden();
        return;
      }
      setError(adminErrorText(err, 'invite'));
      // «Створити запрошення» was disabled while it worked.
      refocus([createRef, ids.title]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card as="section" aria-labelledby={ids.title}>
        <CardHeader
          size="sm"
          as={headingLevel}
          title={USERS_COPY.inviteTitle}
          titleId={ids.title}
          className={f.focusSpot}
        />
        <form className={f.form} onSubmit={(e) => void submit(e)} noValidate>
          <div className={f.field}>
            <label className={f.label} htmlFor={ids.note}>
              {USERS_COPY.noteLabel}
            </label>
            <input
              id={ids.note}
              className={f.input}
              type="text"
              name="invite-note"
              autoComplete="off"
              maxLength={INVITE_NOTE_MAX}
              placeholder={USERS_COPY.notePlaceholder}
              value={note}
              aria-describedby={error ? `${ids.error} ${ids.hint}` : ids.hint}
              onChange={(e) => {
                setNote(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
          {error && (
            <p id={ids.error} className={f.error} role="alert">
              {error}
            </p>
          )}
          <Button ref={createRef} type="submit" size="lg" fullWidth disabled={busy || !online}>
            {busy ? USERS_COPY.creatingInvite : USERS_COPY.createInvite}
          </Button>
          <p id={ids.hint} className={f.note}>
            {USERS_COPY.inviteNote}
          </p>
        </form>
      </Card>
      {created && (
        <LinkCard
          key={created.invite.id}
          purpose="invite"
          path={created.path}
          expiresAt={created.expiresAt}
          headingLevel={headingLevel}
          onDone={() => {
            setCreated(null);
            createRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function InvitesGroup({
  titleId,
  invites,
  online,
  headingLevel,
  onChanged,
  onRevoked,
}: {
  titleId: string;
  invites: readonly AdminInvite[];
  online: boolean;
  onChanged: () => Promise<void>;
  /** A revoke at `index` finished (or failed) and the list was reloaded: the page puts the focus back. */
  onRevoked: (index: number) => void;
} & UsersPageProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (invite: AdminInvite, index: number) => {
    if (!(await ui.confirm(REVOKE_CONFIRM))) return;
    setBusyId(invite.id);
    try {
      await api.admin.revokeInvite({ id: invite.id });
      ui.flash(USERS_COPY.revoked);
    } catch (err) {
      if (isForbidden(err)) {
        noteForbidden();
        return;
      }
      ui.flash(adminErrorText(err, 'revoke'), ERROR_MS);
    } finally {
      setBusyId(null);
    }
    await onChanged();
    onRevoked(index);
  };

  return (
    <section className={s.group} aria-labelledby={titleId}>
      <SectionTitle id={titleId} as={headingLevel} className={groupTitleClass(headingLevel)}>
        {`${USERS_COPY.invitesTitle} · ${invites.length}`}
      </SectionTitle>
      <ListGroup>
        {invites.map((invite, index) => {
          const title = inviteTitle(invite);
          return (
            <ListRow
              key={invite.id}
              icon="link"
              iconTone="neutral"
              title={
                <span className={s.rowTitle}>
                  <span className={s.rowName}>{title}</span>
                  {invite.role === 'admin' && (
                    <>
                      {' '}
                      <Pill tone="acc" size="sm">
                        Адмін
                      </Pill>
                    </>
                  )}
                </span>
              }
              sub={inviteSub(invite)}
              trailing={
                <Button
                  variant="ghost"
                  className={s.revoke}
                  data-revoke=""
                  aria-label={`${USERS_COPY.revoke} запрошення «${title}»`}
                  disabled={!online || busyId !== null}
                  onClick={() => void revoke(invite, index)}
                >
                  {USERS_COPY.revoke}
                </Button>
              }
            />
          );
        })}
      </ListGroup>
    </section>
  );
}

function AccountsGroup({
  titleId,
  users,
  headingLevel,
  onOpen,
}: {
  titleId: string;
  users: readonly AdminUser[];
  onOpen: (id: string) => void;
} & UsersPageProps) {
  return (
    <section className={s.group} aria-labelledby={titleId}>
      <SectionTitle id={titleId} as={headingLevel} className={groupTitleClass(headingLevel)}>
        {`${USERS_COPY.accountsTitle} · ${users.length}`}
      </SectionTitle>
      <ListGroup>
        {users.map((user) => (
          <ListRow
            key={user.id}
            icon="user"
            iconTone={user.status !== 'active' ? 'neutral' : user.role === 'admin' ? 'acc' : 'acc2'}
            title={
              <span className={s.rowTitle}>
                <span className={s.rowName}>{user.username}</span>
                {/* Spaces keep the name «admin Адмін …» in every engine (the gap is only visual). */}
                {userPills(user).map((pill) => (
                  <Fragment key={pill.text}>
                    {' '}
                    <Pill tone={pill.tone} size="sm">
                      {pill.text}
                    </Pill>
                  </Fragment>
                ))}
              </span>
            }
            sub={userRowSub(user)}
            aria-haspopup="dialog"
            onClick={() => onOpen(user.id)}
          />
        ))}
      </ListGroup>
    </section>
  );
}

function AiLimitsCard({
  limits,
  aiToday,
  online,
  headingLevel,
  onSaved,
}: {
  limits: AiLimits;
  aiToday: AdminOverview['aiToday'];
  online: boolean;
  onSaved: () => Promise<void>;
} & UsersPageProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<AiLimits>(limits);
  const [shown, setShown] = useState<AiLimits>(limits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const refocus = useRefocus();
  // New limits from the server (saved here or by another admin): follow them unless she is mid-edit.
  if (limits.perUser !== shown.perUser || limits.global !== shown.global) {
    const editing = draft.perUser !== shown.perUser || draft.global !== shown.global;
    setShown(limits);
    if (!editing) setDraft(limits);
  }
  const changed = draft.perUser !== limits.perUser || draft.global !== limits.global;

  const save = async () => {
    if (!changed || busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.setAiLimits(draft);
      ui.flash(USERS_COPY.saved);
      await onSaved();
    } catch (err) {
      if (isForbidden(err)) {
        noteForbidden();
        return;
      }
      setError(adminErrorText(err, 'limits'));
    } finally {
      setBusy(false);
    }
    // Saved: «Зберегти ліміти» stays disabled (nothing left to save), so the card title takes the focus. Refused:
    // back to the button, enabled again.
    refocus([saveRef, titleId]);
  };

  /** `label` is shown; `name` (it starts with the label) names the stepper with its «за день». */
  const row = (key: keyof AiLimits, label: string, name: string, what: string) => {
    const range = AI_LIMIT_STEPS[key];
    const value = draft[key];
    return (
      <KeyValueRow
        variant="plain"
        className={s.limitRow}
        label={label}
        value={
          <Stepper
            aria-label={name}
            className={s.stepper}
            value={f0(value)}
            decrementLabel={`Зменшити ${what}`}
            incrementLabel={`Збільшити ${what}`}
            canDecrement={value > range.min}
            canIncrement={value < range.max}
            onDecrement={() => setDraft((d) => ({ ...d, [key]: stepLimit(d[key], -1, range) }))}
            onIncrement={() => setDraft((d) => ({ ...d, [key]: stepLimit(d[key], 1, range) }))}
          />
        }
      />
    );
  };

  return (
    <Card as="section" aria-labelledby={titleId} gap={12} className={s.limits}>
      <CardHeader
        size="sm"
        as={headingLevel}
        title={USERS_COPY.aiTitle}
        subtitle={USERS_COPY.aiSubtitle}
        titleId={titleId}
        className={f.focusSpot}
      />
      {row('perUser', USERS_COPY.aiPerUser, USERS_COPY.aiPerUserName, 'ліміт на людину')}
      {row('global', USERS_COPY.aiGlobal, USERS_COPY.aiGlobalName, 'ліміт на всіх')}
      <p className={f.note}>{USERS_COPY.aiZeroHint}</p>
      <p className={f.note}>{aiTodayLine(aiToday.used, aiToday.ceiling)}</p>
      {error && (
        <p className={f.error} role="alert">
          {error}
        </p>
      )}
      <Button
        ref={saveRef}
        size="lg"
        fullWidth
        disabled={!changed || busy || !online}
        onClick={() => void save()}
      >
        {USERS_COPY.saveLimits}
      </Button>
    </Card>
  );
}
