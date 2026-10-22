import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { findExercise, LIMITS } from '@legko/shared';
import { ExercisePickerSheet } from '@/features/exercises';
import { WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { dataActions, newId, useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { Banner, Button, Card, Field, fullRowClass, cx, useBackTo, useFieldA11y, WeekdayPicker } from '@/ui';
import { BuilderItemCard } from './BuilderItemCard';
import {
  addExercises,
  addedPlanDays,
  daysNote,
  draftFrom,
  dropIndex,
  duplicateItem,
  isDirty,
  moveItem,
  moveItemTo,
  parseBuilderDraft,
  removeItem,
  savedToast,
  toWorkout,
  updateItem,
  validate,
  type BuilderDraft,
  type BuilderErrors,
} from './builderModel';
import { clearDraft, readDraft, workoutDraftKey, writeDraft } from './drafts';
import { PageHeader } from './PageHeader';
import s from './WorkoutBuilderScreen.module.css';

export const RESTORED_TITLE = 'Є незбережені зміни · Відновлено';
export const LEAVE_CONFIRM = 'Вийти без збереження?';

export interface WorkoutBuilderScreenProps {
  /** Absent: a new workout (`/workouts/new`). */
  id?: string;
}

interface Drag {
  key: string;
  from: number;
  startY: number;
  dy: number;
  rects: { top: number; height: number }[];
}

/**
 * The builder (`/workouts/new`, `/workouts/edit/:id`, §3.6): name, weekdays, ordered exercise cards with planned sets
 * and rest, «+ Додати вправи», sticky «Зберегти». Every change is autosaved as a draft (restored on the next visit);
 * only the own «‹» asks before leaving.
 */
export function WorkoutBuilderScreen({ id }: WorkoutBuilderScreenProps) {
  const data = useAppData();
  const stored = id ? data.workouts.find((w) => w.id === id) : undefined;
  if (id && !stored) return <NotFound />;
  return <Builder key={id ?? 'new'} id={id ?? null} />;
}

function NotFound() {
  const back = useBackTo(WORKOUTS_PATH);
  return (
    <div className={s.page}>
      <PageHeader
        back={{ href: WORKOUTS_PATH, label: 'Мої тренування', onBack: () => back() }}
        title="Тренування не знайдено"
      />
      <Card className={fullRowClass}>
        <p className={s.muted}>Можливо, його видалили на іншому пристрої.</p>
      </Card>
    </div>
  );
}

/** «Назва»: labelled by the Field above it (and described by its error). */
function NameInput({
  inputRef,
  invalid,
  value,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  invalid: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const a11y = useFieldA11y({});
  return (
    <input
      ref={inputRef}
      {...a11y}
      className={cx(s.input, invalid && s.invalid)}
      value={value}
      maxLength={LIMITS.workoutName}
      placeholder="Наприклад, Ноги + прес"
      autoComplete="off"
      enterKeyHint="done"
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Builder({ id }: { id: string | null }) {
  const data = useAppData();
  const backTo = useBackTo(WORKOUTS_PATH);
  const draftKey = workoutDraftKey(id);

  // What was opened (the stored workout), and the restored draft if one was left behind — read once per visit.
  const [original] = useState<BuilderDraft>(() =>
    draftFrom(id ? data.workouts.find((w) => w.id === id) : null),
  );
  const [initial] = useState(() => {
    const restored = readDraft(draftKey, parseBuilderDraft);
    return restored && isDirty(restored, original) ? restored : null;
  });
  const [draft, setDraftState] = useState<BuilderDraft>(initial ?? original);
  const [restored, setRestored] = useState(initial !== null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<BuilderErrors | null>(null);
  const [announce, setAnnounce] = useState('');
  const [focusMove, setFocusMove] = useState<{ key: string; dir: 'up' | 'down' } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const dirty = isDirty(draft, original);
  const setDraft = (next: BuilderDraft) => {
    setDraftState(next);
    if (isDirty(next, original)) writeDraft(draftKey, next);
    else clearDraft(draftKey);
  };

  // After ↑ / ↓ the same button keeps focus (the other one when the card reached an end).
  useEffect(() => {
    if (!focusMove) return;
    const root = listRef.current;
    const same = root?.querySelector<HTMLButtonElement>(`[data-move="${focusMove.key}:${focusMove.dir}"]`);
    const other = root?.querySelector<HTMLButtonElement>(
      `[data-move="${focusMove.key}:${focusMove.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (same && !same.disabled ? same : other)?.focus();
  }, [focusMove]);

  const exerciseOf = (exerciseId: string) => findExercise(data.exercises, exerciseId);
  const positionText = (next: BuilderDraft, key: string) => {
    const i = next.items.findIndex((x) => x.key === key);
    const ex = next.items[i];
    return ex
      ? `${exerciseOf(ex.exerciseId)?.name ?? 'Вправу видалено'} — ${i + 1} з ${next.items.length}`
      : '';
  };

  const move = (key: string, delta: -1 | 1) => {
    const next = moveItem(draft, key, delta);
    setDraft(next);
    setAnnounce(positionText(next, key));
    setFocusMove({ key, dir: delta < 0 ? 'up' : 'down' });
  };

  const gripDown = (key: string, index: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    const cards = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    const rects = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom / old engines
    }
    e.preventDefault();
    setDrag({ key, from: index, startY: e.clientY, dy: 0, rects });
  };
  const gripMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const gripUp = () => {
    if (!drag) return;
    const to = dropIndex(drag.rects, drag.from, drag.dy);
    setDrag(null);
    if (to === drag.from) return;
    const next = moveItemTo(draft, drag.from, to);
    setDraft(next);
    setAnnounce(positionText(next, drag.key));
  };

  const remove = (key: string) => {
    setDraft(removeItem(draft, key));
    if (expanded === key) setExpanded(null);
    ui.flash('Вправу прибрано');
  };

  const leave = () => backTo();
  const onBack = async () => {
    if (
      dirty &&
      !(await ui.confirm({ title: LEAVE_CONFIRM, confirmLabel: 'Вийти', cancelLabel: 'Залишитися' }))
    )
      return;
    clearDraft(draftKey);
    leave();
  };

  const discard = () => {
    clearDraft(draftKey);
    setDraftState(original);
    setRestored(false);
    setErrors(null);
  };

  const save = () => {
    const found = validate(draft, data.exercises);
    setErrors(found);
    if (found) {
      if (found.name) nameRef.current?.focus();
      return;
    }
    const workout = toWorkout(draft, draft.id ?? newId(), data.exercises);
    const added = addedPlanDays(data.settings, workout.days);
    if (!dataActions.saveWorkout(workout)) {
      ui.flash('Не вдалося зберегти тренування');
      return;
    }
    clearDraft(draftKey);
    ui.flash(savedToast(added));
    leave();
  };

  const removeWorkout = async () => {
    const ok = await ui.confirm({
      title: `Видалити тренування «${original.name}»?`,
      body: 'Записані тренування залишаться.',
      confirmLabel: 'Видалити',
      destructive: true,
    });
    if (!ok || !id) return;
    if (dataActions.deleteWorkout(id)) {
      clearDraft(draftKey);
      ui.flash('Тренування видалено');
      leave();
    }
  };

  const title = id ? original.name || 'Тренування' : 'Нове тренування';
  const canAdd = draft.items.length < LIMITS.workoutItems;
  const summary = useMemo(() => daysNote(data.settings), [data.settings]);

  return (
    <div className={s.page}>
      <PageHeader
        back={{ href: WORKOUTS_PATH, label: 'Мої тренування', onBack: () => void onBack() }}
        title={title}
      />

      {restored && (
        <div className={cx(s.restored, fullRowClass)}>
          <Banner size="compact" title={RESTORED_TITLE} />
          <Button variant="ghost" onClick={discard}>
            Скинути
          </Button>
        </div>
      )}

      <div className={cx(s.form, fullRowClass)}>
        <Field label="Назва" hint={errors?.name}>
          <NameInput
            inputRef={nameRef}
            invalid={Boolean(errors?.name)}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
          />
        </Field>
        <Field label="Дні" hint={summary}>
          <WeekdayPicker
            mode="multi"
            aria-label="Дні тренувань"
            value={draft.days}
            onChange={(days) => setDraft({ ...draft, days })}
          />
        </Field>
      </div>

      <section className={cx(s.items, fullRowClass)} aria-labelledby="builder-items">
        <h2 id="builder-items" className={s.heading}>
          Вправи
        </h2>
        {draft.items.length > 0 ? (
          <ol ref={listRef} className={s.list}>
            {draft.items.map((item, index) => (
              <BuilderItemCard
                key={item.key}
                item={item}
                exercise={exerciseOf(item.exerciseId)}
                index={index}
                count={draft.items.length}
                expanded={expanded === item.key}
                onExpand={(open) => setExpanded(open ? item.key : null)}
                onChange={(next) => setDraft(updateItem(draft, item.key, () => next))}
                onMove={(delta) => move(item.key, delta)}
                onDuplicate={() => setDraft(duplicateItem(draft, item.key, newId()))}
                onRemove={() => remove(item.key)}
                onGripDown={gripDown(item.key, index)}
                onGripMove={gripMove}
                onGripUp={gripUp}
                dragOffset={drag?.key === item.key ? drag.dy : null}
              />
            ))}
          </ol>
        ) : (
          <p className={s.muted}>Додай вправи з бібліотеки — підходи й вага підставляться з минулого разу.</p>
        )}
        {errors?.items && (
          <p className={s.error} role="alert">
            {errors.items}
          </p>
        )}
        <Button
          variant="outline"
          fullWidth
          disabled={!canAdd}
          aria-haspopup="dialog"
          onClick={() => setPicking(true)}
        >
          + Додати вправи
        </Button>
      </section>

      {id && (
        <div className={fullRowClass}>
          <Button variant="ghost" className={s.danger} onClick={() => void removeWorkout()}>
            Видалити тренування
          </Button>
        </div>
      )}

      <div className={cx(s.footer, fullRowClass)}>
        <Button size="lg" fullWidth onClick={save}>
          Зберегти
        </Button>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      <ExercisePickerSheet
        open={picking}
        mode="multi"
        onClose={() => setPicking(false)}
        onPick={(ids) => setDraft(addExercises(draft, data, ids, newId))}
      />
    </div>
  );
}
