import { useEffect, useRef, useState } from 'react';
import { dLong, findExercise, isLiveSession, type WorkoutSession } from '@legko/shared';
import { ExercisePickerSheet } from '@/features/exercises';
import { useClock } from '@/sheets/useClock';
import { dataActions, deviceId, newId, useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { Banner, Button, cx, fullRowClass, useBackTo } from '@/ui';
import type { BackTarget } from './backTarget';
import { elapsedText } from './copy';
import { PageHeader } from './PageHeader';
import { RestTimer } from './RestTimer';
import { adjustRest, clearRestEnd, clockNow, readRestEnd, writeRestEnd } from './restModel';
import { SessionExerciseCard } from './SessionExerciseCard';
import {
  addExercise,
  addSet,
  applyHint,
  cardState,
  confirmLabel,
  confirmSet,
  currentPosition,
  findEntry,
  finishPlan,
  lastTime,
  moveExercise,
  progressOf,
  progressText,
  removeExercise,
  removeSet,
  restAfter,
  setSkipped,
  toggleSet,
  undoneBody,
  updateSet,
  type SetPosition,
} from './sessionModel';
import { useWakeLock } from './useWakeLock';
import s from './SessionScreen.module.css';

export const OTHER_DEVICE = 'Тренування триває на іншому пристрої';
export const STALE_TITLE = 'Це тренування не завершено';
export const FINISH_EMPTY = 'Нічого не відмічено. Видалити це тренування?';

export interface LiveSessionProps {
  session: WorkoutSession;
  back: BackTarget;
  /** Called once `finishSession` committed (the route then shows the summary). */
  onFinished: () => void;
  /** Called after the session was deleted here (the route goes back). */
  onDeleted: () => void;
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * A session in progress (`status: 'active'`, §3.9): exercise by exercise, sets with ✓, the current set's steppers,
 * the sticky footer that confirms it, the rest bar, the elapsed timer and «Завершити». Every change is a
 * `saveSession` (offline outbox). Another device's session is read-only until «Продовжити тут»; a stale one (> 6 h)
 * has no timers and offers «Завершити» / «Видалити».
 */
export function LiveSession({ session, back, onFinished, onDeleted }: LiveSessionProps) {
  const data = useAppData();
  const [me] = useState(deviceId);
  const now = useClock(true, 1000);
  const live = isLiveSession(session, now);
  const editable = session.deviceId === me;
  useWakeLock(live && editable);
  const backTo = useBackTo(back.href);

  const [restEndsAt, setRestEndsAt] = useState<number | null>(() => readRestEnd(session.id, clockNow()));
  const [selected, setSelected] = useState<SetPosition | null>(null);
  const [opened, setOpened] = useState<readonly string[]>([]);
  const [hintApplied, setHintApplied] = useState<Readonly<Record<string, boolean>>>({});
  const applied = useRef(new Set<string>());
  const [picking, setPicking] = useState(false);

  const current = currentPosition(session);
  const selectedSet = selected ? findEntry(session, selected.key)?.sets[selected.index] : undefined;
  const target = selected && selectedSet && !selectedSet.done ? selected : current;
  const targetEntry = target ? findEntry(session, target.key) : undefined;

  // The current exercise comes into view when it changes (block: nearest — no jump when it is already visible).
  const currentKey = current?.key ?? null;
  useEffect(() => {
    if (currentKey === null) return;
    const el = document.querySelector(`[data-entry="${currentKey}"]`);
    el?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [currentKey]);

  const save = (next: WorkoutSession) => dataActions.saveSession(next);

  const setRest = (endsAt: number | null) => {
    setRestEndsAt(endsAt);
    if (endsAt === null) clearRestEnd(session.id);
    else writeRestEnd(session.id, endsAt);
  };

  const confirm = (pos: SetPosition) => {
    const rest = restAfter(session, pos.key, pos.index);
    if (!save(confirmSet(session, pos.key, pos.index))) return;
    setSelected(null);
    setRest(rest > 0 && live ? clockNow() + rest * 1000 : null);
  };

  const toggle = (key: string, index: number) => {
    const set = findEntry(session, key)?.sets[index];
    if (!set) return;
    if (!set.done) confirm({ key, index });
    else save(toggleSet(session, key, index));
  };

  const hint = (key: string, sign: 1 | -1) => {
    const ex = findEntry(session, key);
    const h = ex ? lastTime(data, session, ex).hint : null;
    if (!h) return;
    // One-shot (a double tap never adds twice): the ref answers before React re-renders.
    if (sign === 1 ? applied.current.has(key) : !applied.current.has(key)) return;
    if (sign === 1) applied.current.add(key);
    else applied.current.delete(key);
    setHintApplied((m) => ({ ...m, [key]: sign === 1 }));
    save(applyHint(session, key, h, sign));
  };

  const finish = async () => {
    const plan = finishPlan(session);
    if (plan.kind === 'empty') {
      const ok = await ui.confirm({ title: FINISH_EMPTY, confirmLabel: 'Видалити', destructive: true });
      if (!ok) return;
      if (dataActions.deleteSession(session.id)) {
        clearRestEnd(session.id);
        ui.flash('Тренування видалено');
        onDeleted();
      }
      return;
    }
    if (plan.kind === 'undone') {
      const ok = await ui.confirm({
        title: 'Завершити тренування?',
        body: undoneBody(plan.count),
        confirmLabel: 'Завершити',
      });
      if (!ok) return;
    }
    if (dataActions.finishSession(session.id)) {
      clearRestEnd(session.id);
      onFinished();
    }
  };

  const removeStale = async () => {
    const ok = await ui.confirm({
      title: `Видалити тренування за ${dLong(session.date)}?`,
      body: 'Відмітка «Було» за цей день залишиться.',
      confirmLabel: 'Видалити',
      destructive: true,
    });
    if (ok && dataActions.deleteSession(session.id)) {
      clearRestEnd(session.id);
      ui.flash('Тренування видалено');
      onDeleted();
    }
  };

  const elapsed = Math.max(0, now - (session.startedAt ?? now)) / 1000;
  const showRest = live && editable && restEndsAt !== null;

  return (
    <div className={s.page}>
      <PageHeader
        back={{
          href: back.href,
          label: 'Згорнути',
          ariaLabel: 'Згорнути тренування',
          onBack: () => backTo(),
        }}
        title={session.name}
        subtitle={progressText(progressOf(session))}
        right={
          <>
            {live && (
              <span className={s.timer} role="timer" aria-label={`Тривалість ${elapsedText(elapsed)}`}>
                {elapsedText(elapsed)}
              </span>
            )}
            {editable && (
              <Button size="sm" onClick={() => void finish()}>
                Завершити
              </Button>
            )}
          </>
        }
      />

      {!editable && (
        <Banner
          size="compact"
          title={OTHER_DEVICE}
          cta="Продовжити тут"
          onAction={() => {
            if (!dataActions.takeOverSession(session.id)) ui.flash('Не вдалося продовжити тут');
          }}
        />
      )}
      {editable && !live && (
        <div className={cx(s.stale, fullRowClass)}>
          <Banner
            size="compact"
            title={STALE_TITLE}
            sub={dLong(session.date)}
            cta="Завершити"
            onAction={() => void finish()}
          />
          <Button variant="ghost" className={s.danger} onClick={() => void removeStale()}>
            Видалити
          </Button>
        </div>
      )}

      <ol className={cx(s.cards, fullRowClass)}>
        {session.exercises.map((ex, i) => {
          const state = cardState(ex, current);
          const isOpen = state === 'current' || opened.includes(ex.key);
          const lt = state === 'current' || isOpen ? lastTime(data, session, ex) : null;
          const editIndex =
            selected?.key === ex.key ? selected.index : state === 'current' && current ? current.index : null;
          return (
            <SessionExerciseCard
              key={ex.key}
              ex={ex}
              state={state}
              expanded={isOpen}
              onToggleExpanded={
                state === 'current'
                  ? undefined
                  : () =>
                      setOpened((o) => (o.includes(ex.key) ? o.filter((k) => k !== ex.key) : [...o, ex.key]))
              }
              editable={editable}
              editIndex={editIndex}
              lastSummary={lt?.summary}
              hint={lt?.hint}
              hintApplied={hintApplied[ex.key] === true}
              onHint={() => hint(ex.key, 1)}
              onHintUndo={() => hint(ex.key, -1)}
              onToggleSet={(index) => toggle(ex.key, index)}
              onSelectSet={(index) => {
                setSelected({ key: ex.key, index });
                if (!isOpen) setOpened((o) => [...o, ex.key]);
              }}
              onUpdate={(index, field, value) => save(updateSet(session, ex.key, index, field, value))}
              onAddSet={() => save(addSet(session, ex.key))}
              onRemoveSet={(index) => {
                save(removeSet(session, ex.key, index));
                setSelected(null);
              }}
              onSkip={(skipped) => save(setSkipped(session, ex.key, skipped))}
              onRemove={() => {
                if (save(removeExercise(session, ex.key))) ui.flash('Вправу прибрано');
              }}
              onMove={(delta) => save(moveExercise(session, ex.key, delta))}
              isFirst={i === 0}
              isLast={i === session.exercises.length - 1}
            />
          );
        })}
      </ol>

      {editable && (
        <div className={cx(s.after, fullRowClass)}>
          <Button variant="outline" fullWidth aria-haspopup="dialog" onClick={() => setPicking(true)}>
            + Додати вправу
          </Button>
          <Button variant="outline" fullWidth onClick={() => void finish()}>
            Завершити тренування
          </Button>
        </div>
      )}

      {editable && (
        <div className={cx(s.footer, fullRowClass)}>
          {showRest && restEndsAt !== null && (
            <RestTimer
              endsAt={restEndsAt}
              now={now}
              onAdjust={(delta) => setRest(adjustRest(restEndsAt, clockNow(), delta))}
              onSkip={() => setRest(null)}
              onHide={() => setRest(null)}
            />
          )}
          {target && targetEntry ? (
            <Button size="lg" fullWidth onClick={() => confirm(target)}>
              {confirmLabel(targetEntry, target.index)}
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={() => void finish()}>
              Завершити тренування
            </Button>
          )}
        </div>
      )}

      <ExercisePickerSheet
        open={picking}
        mode="single"
        onClose={() => setPicking(false)}
        onPick={([id]) => {
          const exercise = id ? findExercise(data.exercises, id) : undefined;
          if (exercise) save(addExercise(session, data, exercise, newId(), false));
        }}
      />
    </div>
  );
}
