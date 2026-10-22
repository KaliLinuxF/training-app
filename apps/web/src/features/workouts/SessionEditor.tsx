import { useState } from 'react';
import {
  dLong,
  dWeekdayLong,
  findExercise,
  sessionSchema,
  setsDone,
  type WorkoutSession,
} from '@legko/shared';
import { ExercisePickerSheet } from '@/features/exercises';
import { dataActions, newId, useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { Banner, Button, cx, fullRowClass } from '@/ui';
import { clearDraft, readDraft, writeDraft } from './drafts';
import { NumField } from './NumField';
import { PageHeader } from './PageHeader';
import { SessionExerciseCard } from './SessionExerciseCard';
import {
  addExercise,
  addSet,
  moveExercise,
  removeExercise,
  removeSet,
  setSkipped,
  toggleSet,
  updateSet,
  type SetPosition,
} from './sessionModel';
import s from './SessionScreen.module.css';

export const RESTORED_TITLE = 'Є незбережені зміни · Відновлено';
export const NOTHING_DONE = 'Відміть хоча б один підхід';

export interface SessionEditorProps {
  /** The stored done session (edit) or the past-day draft (log). */
  initial: WorkoutSession;
  /** `log`: a past day, not stored yet; `edit`: a done session. */
  kind: 'log' | 'edit';
  draftKey: string;
  /** The own «‹» (asks first when changed). */
  back: { href: string; label: string };
  /** After «Зберегти» committed. */
  onSaved: (session: WorkoutSession) => void;
  /** Leaving without saving (the draft is dropped). */
  onLeave: () => void;
  /** After «Видалити тренування» (edit only). */
  onDeleted?: () => void;
}

/** A restored draft: a valid session of the same date (and, when editing, the same id). */
function parseDraft(initial: WorkoutSession, kind: 'log' | 'edit') {
  return (value: unknown): WorkoutSession | null => {
    const parsed = sessionSchema.safeParse(value);
    if (!parsed.success) return null;
    const v = parsed.data as WorkoutSession;
    if (v.date !== initial.date || (kind === 'edit' && v.id !== initial.id)) return null;
    return v;
  };
}

const same = (a: WorkoutSession, b: WorkoutSession): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The edit mode of a done session and the past-day log (§3.12): every set editable (done by default, ✓ toggles),
 * «Тривалість, хв» (empty = unknown), «+ Додати вправу», «Зберегти» → `saveDoneSession`. Changes are autosaved as a
 * draft and offered back on the next visit; only the own «‹» asks before leaving.
 */
export function SessionEditor({
  initial,
  kind,
  draftKey,
  back,
  onSaved,
  onLeave,
  onDeleted,
}: SessionEditorProps) {
  const data = useAppData();
  const [original] = useState(initial);
  const [restoredDraft] = useState(() => {
    const d = readDraft(draftKey, parseDraft(initial, kind));
    return d && !same(d, initial) ? d : null;
  });
  const [session, setSessionState] = useState<WorkoutSession>(restoredDraft ?? initial);
  const [restored, setRestored] = useState(restoredDraft !== null);
  const [selected, setSelected] = useState<SetPosition | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !same(session, original);
  const update = (next: WorkoutSession) => {
    setSessionState(next);
    setError(null);
    if (same(next, original)) clearDraft(draftKey);
    else writeDraft(draftKey, next);
  };

  const leave = async () => {
    if (
      dirty &&
      !(await ui.confirm({
        title: 'Вийти без збереження?',
        confirmLabel: 'Вийти',
        cancelLabel: 'Залишитися',
      }))
    )
      return;
    clearDraft(draftKey);
    onLeave();
  };

  const discard = () => {
    clearDraft(draftKey);
    setSessionState(original);
    setRestored(false);
  };

  const save = () => {
    if (setsDone(session) === 0) {
      setError(NOTHING_DONE);
      return;
    }
    if (!dataActions.saveDoneSession(session)) {
      ui.flash('Не вдалося зберегти тренування');
      return;
    }
    clearDraft(draftKey);
    onSaved(session);
  };

  const remove = async () => {
    const ok = await ui.confirm({
      title: `Видалити тренування за ${dLong(session.date)}?`,
      body: 'Відмітка «Було» за цей день залишиться.',
      confirmLabel: 'Видалити',
      destructive: true,
    });
    if (!ok) return;
    if (dataActions.deleteSession(session.id)) {
      clearDraft(draftKey);
      ui.flash('Тренування видалено');
      onDeleted?.();
    }
  };

  const minutes = session.durationSec === null ? null : Math.round(session.durationSec / 60);

  return (
    <div className={s.page}>
      <PageHeader
        back={{ href: back.href, label: back.label, onBack: () => void leave() }}
        title={session.name}
        subtitle={
          kind === 'log'
            ? `Запис за ${dWeekdayLong(session.date).toLocaleLowerCase('uk')}`
            : dWeekdayLong(session.date)
        }
      />

      {restored && (
        <div className={cx(s.stale, fullRowClass)}>
          <Banner size="compact" title={RESTORED_TITLE} />
          <Button variant="ghost" onClick={discard}>
            Скинути
          </Button>
        </div>
      )}

      <div className={cx(s.duration, fullRowClass)}>
        <NumField
          label="Тривалість, хв"
          value={minutes}
          parse={(t) => {
            if (t.trim() === '') return null;
            const n = Number(t.replace(',', '.'));
            return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : undefined;
          }}
          format={(v) => (v === null ? '' : String(v))}
          step={(v, sign) => Math.max(0, Math.min(1440, (v ?? 0) + sign * 5))}
          onChange={(v) => update({ ...session, durationSec: v === null ? null : v * 60 })}
          unit="хв"
          inputMode="numeric"
        />
      </div>

      <ol className={cx(s.cards, fullRowClass)}>
        {session.exercises.map((ex, i) => (
          <SessionExerciseCard
            key={ex.key}
            ex={ex}
            state={ex.skipped ? 'skipped' : 'upcoming'}
            expanded
            editable
            editIndex={selected?.key === ex.key ? selected.index : null}
            onToggleSet={(index) => update(toggleSet(session, ex.key, index))}
            onSelectSet={(index) => setSelected({ key: ex.key, index })}
            onUpdate={(index, field, value) => update(updateSet(session, ex.key, index, field, value))}
            onAddSet={() => update(addSet(session, ex.key, true))}
            onRemoveSet={(index) => {
              update(removeSet(session, ex.key, index));
              setSelected(null);
            }}
            onSkip={(skipped) => update(setSkipped(session, ex.key, skipped))}
            onRemove={() => update(removeExercise(session, ex.key))}
            onMove={(delta) => update(moveExercise(session, ex.key, delta))}
            isFirst={i === 0}
            isLast={i === session.exercises.length - 1}
          />
        ))}
      </ol>

      <div className={cx(s.after, fullRowClass)}>
        <Button variant="outline" fullWidth aria-haspopup="dialog" onClick={() => setPicking(true)}>
          + Додати вправу
        </Button>
        {kind === 'edit' && (
          <Button variant="ghost" className={s.danger} onClick={() => void remove()}>
            Видалити тренування
          </Button>
        )}
      </div>

      <div className={cx(s.footer, fullRowClass)}>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <Button size="lg" fullWidth onClick={save}>
          Зберегти
        </Button>
      </div>

      <ExercisePickerSheet
        open={picking}
        mode="single"
        onClose={() => setPicking(false)}
        onPick={([id]) => {
          const exercise = id ? findExercise(data.exercises, id) : undefined;
          if (exercise) update(addExercise(session, data, exercise, newId(), true));
        }}
      />
    </div>
  );
}
