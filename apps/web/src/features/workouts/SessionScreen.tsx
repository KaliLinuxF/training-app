import { useState } from 'react';
import { sessionPath } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { backState, Button, Card, fullRowClass, useBackTo } from '@/ui';
import { backTarget, type BackTarget } from './backTarget';
import { readDraft, sessionDraftKey } from './drafts';
import { LiveSession } from './LiveSession';
import { PageHeader } from './PageHeader';
import { SessionEditor } from './SessionEditor';
import { SessionSummary } from './SessionSummary';
import s from './SessionScreen.module.css';

/** `history.state` key: the summary was opened right after saving (shows «✓ Тренування збережено»). */
export const SAVED_STATE_KEY = 'legkoSaved';

/** The pages a session screen never goes back to (itself, the past-day log it replaced). */
const NOT_BACK = ['/workouts/session/', '/workouts/log'];

const savedState = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[SAVED_STATE_KEY] === true;

export interface SessionScreenProps {
  id: string;
}

/**
 * `/workouts/session/:id`: the live session (status active, §3.9), or the summary of a done one (§3.11) with its
 * edit mode (§3.12). A session that is gone (deleted elsewhere) says so.
 */
export function SessionScreen({ id }: SessionScreenProps) {
  const data = useAppData();
  const session = data.sessions.find((x) => x.id === id);
  // Read once per visit: where «‹» / «Готово» go, and whether this page came right after a save.
  const [back] = useState<BackTarget>(() => backTarget(window.history.state, '/', NOT_BACK));
  const [justSaved, setJustSaved] = useState(() => savedState(window.history.state));
  const [editing, setEditing] = useState(() => readDraft(sessionDraftKey(id), (v) => v) !== null);
  // Deleted here: going back, not «не знайдено» for the moment the navigation takes.
  const [leaving, setLeaving] = useState(false);
  const backTo = useBackTo(back.href);
  const gone = () => {
    setLeaving(true);
    backTo();
  };

  if (leaving) return null;
  if (!session) return <SessionMissing back={back} />;
  if (session.status === 'active')
    return (
      <LiveSession
        key={session.id}
        session={session}
        back={back}
        onFinished={() => setJustSaved(true)}
        onDeleted={gone}
      />
    );
  if (editing)
    return (
      <SessionEditor
        key={`edit-${session.id}`}
        initial={session}
        kind="edit"
        draftKey={sessionDraftKey(session.id)}
        back={{ href: sessionPath(session.id), label: 'Підсумок' }}
        onSaved={() => {
          setEditing(false);
          setJustSaved(false);
          ui.flash('Збережено');
        }}
        onLeave={() => setEditing(false)}
        onDeleted={gone}
      />
    );
  return (
    <SessionSummary
      session={session}
      back={back}
      justSaved={justSaved}
      onEdit={() => {
        setJustSaved(false);
        setEditing(true);
      }}
    />
  );
}

function SessionMissing({ back }: { back: BackTarget }) {
  const backTo = useBackTo(back.href);
  return (
    <div className={s.page}>
      <PageHeader
        back={{ href: back.href, label: back.label, onBack: () => backTo() }}
        title="Тренування не знайдено"
      />
      <Card className={fullRowClass} gap={12}>
        <p className={s.muted}>Можливо, його видалили на іншому пристрої.</p>
        <Button variant="outline" onClick={() => backTo()}>
          Назад
        </Button>
      </Card>
    </div>
  );
}

/** Navigation state for opening a session's summary right after saving it (replacing the log page). */
export function savedSessionState(from: string | null): Record<string, unknown> {
  return { ...(from === null ? {} : backState(from)), [SAVED_STATE_KEY]: true };
}
