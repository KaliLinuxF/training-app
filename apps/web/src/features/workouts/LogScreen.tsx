import { useState } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { isValidISODate, type ISODate } from '@legko/shared';
import { useToday } from '@/lib/useToday';
import { sessionPath, WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { dataActions } from '@/store/data';
import { cameFrom, useBackTo } from '@/ui';
import { backTarget } from './backTarget';
import { logDraftKey } from './drafts';
import { SessionEditor } from './SessionEditor';
import { savedSessionState } from './SessionScreen';

/**
 * `/workouts/log?date=&workout=` (§3.12): a past day's workout, built once per visit with `draftSession` (not stored
 * until «Зберегти»), in the edit layout. After saving, the summary replaces this page.
 */
export function LogScreen() {
  const params = new URLSearchParams(useSearch());
  const date = params.get('date') ?? '';
  const workoutId = params.get('workout');
  const today = useToday();
  if (!isValidISODate(date) || date > today) return <Redirect to={WORKOUTS_PATH} replace />;
  return <LogEditor key={`${date}.${workoutId ?? ''}`} date={date} workoutId={workoutId} />;
}

function LogEditor({ date, workoutId }: { date: ISODate; workoutId: string | null }) {
  const [, navigate] = useLocation();
  const [back] = useState(() =>
    backTarget(window.history.state, '/', ['/workouts/log', '/workouts/session/']),
  );
  // The summary pops back to that page only when this one was really opened from it (else it replace-navigates).
  const [stamped] = useState(() => cameFrom(window.history.state, back.href));
  const [draft] = useState(() => dataActions.draftSession(date, workoutId));
  const backTo = useBackTo(back.href);
  return (
    <SessionEditor
      initial={draft}
      kind="log"
      draftKey={logDraftKey(date, workoutId)}
      back={back}
      onSaved={(saved) =>
        navigate(sessionPath(saved.id), {
          replace: true,
          state: savedSessionState(stamped ? back.href : null),
        })
      }
      onLeave={() => backTo()}
    />
  );
}
