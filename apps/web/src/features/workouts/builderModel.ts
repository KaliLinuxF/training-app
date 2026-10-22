/**
 * The workout builder's draft and every change to it (docs/workouts-steps-rebrand.md §3.6), pure. The screen keeps
 * a `BuilderDraft` in state, autosaves it (drafts.ts) and turns it into a `Workout` with `toWorkout` on «Зберегти».
 */
import {
  DEFAULT_REST_SEC,
  DEFAULT_SET,
  DOW_SHORT,
  LIMITS,
  WEEK_ORDER,
  findExercise,
  formatSetsSummary,
  lastPerformance,
  sessionExerciseFrom,
  setForKind,
  type AppData,
  type Exercise,
  type SetValues,
  type Settings,
  type Weekday,
  type Workout,
  type WorkoutItem,
} from '@legko/shared';
import { clockText } from './copy';
import { fitField, type SetField } from './setFields';

export interface BuilderDraft {
  /** null: a new workout (its id is made on the first save). */
  id: string | null;
  name: string;
  days: Weekday[];
  items: WorkoutItem[];
}

export const NAME_REQUIRED = 'Дай тренуванню назву';
export const ITEMS_REQUIRED = 'Додай хоча б одну вправу';

/** A draft of `workout`, or an empty one. Copies, so editing never touches the stored workout. */
export function draftFrom(workout: Workout | null | undefined): BuilderDraft {
  if (!workout) return { id: null, name: '', days: [], items: [] };
  return {
    id: workout.id,
    name: workout.name,
    days: [...workout.days],
    items: workout.items.map((i) => ({ ...i, sets: i.sets.map((s) => ({ ...s })) })),
  };
}

const sameItem = (a: WorkoutItem, b: WorkoutItem): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Changed compared with what was opened (names compared trimmed). */
export function isDirty(draft: BuilderDraft, original: BuilderDraft): boolean {
  if (draft.name.trim() !== original.name.trim()) return true;
  if (draft.days.join() !== original.days.join()) return true;
  if (draft.items.length !== original.items.length) return true;
  return draft.items.some((item, i) => !sameItem(item, original.items[i] as WorkoutItem));
}

/**
 * Planned values of a new item: her last performance's done sets (if any), else the kind's default sets; rest = the
 * kind's default.
 */
export function newItem(data: Pick<AppData, 'sessions'>, exercise: Exercise, key: string): WorkoutItem {
  const last = lastPerformance(data.sessions, exercise.id, null);
  const entry = sessionExerciseFrom(exercise, null, last, { key });
  return {
    key,
    exerciseId: exercise.id,
    sets: entry.sets.slice(0, LIMITS.plannedSets).map((s) => setForKind(exercise.kind, s)),
    restSec: DEFAULT_REST_SEC[exercise.kind],
  };
}

/** Adds the picked exercises at the end (unknown ids are left out; at most 30 items). */
export function addExercises(
  draft: BuilderDraft,
  data: Pick<AppData, 'sessions' | 'exercises'>,
  ids: readonly string[],
  newKey: () => string,
): BuilderDraft {
  const added: WorkoutItem[] = [];
  for (const id of ids) {
    const exercise = findExercise(data.exercises, id);
    if (exercise) added.push(newItem(data, exercise, newKey()));
  }
  return { ...draft, items: [...draft.items, ...added].slice(0, LIMITS.workoutItems) };
}

export const removeItem = (draft: BuilderDraft, key: string): BuilderDraft => ({
  ...draft,
  items: draft.items.filter((i) => i.key !== key),
});

/** A copy (new key) right after the item. */
export function duplicateItem(draft: BuilderDraft, key: string, newKey: string): BuilderDraft {
  const index = draft.items.findIndex((i) => i.key === key);
  const item = draft.items[index];
  if (!item || draft.items.length >= LIMITS.workoutItems) return draft;
  const copy: WorkoutItem = { ...item, key: newKey, sets: item.sets.map((s) => ({ ...s })) };
  const items = [...draft.items];
  items.splice(index + 1, 0, copy);
  return { ...draft, items };
}

/** Moves the item from index `from` to index `to` (clamped). */
export function moveItemTo(draft: BuilderDraft, from: number, to: number): BuilderDraft {
  const items = [...draft.items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from < 0 || from >= items.length || from === target) return draft;
  const [item] = items.splice(from, 1);
  if (!item) return draft;
  items.splice(target, 0, item);
  return { ...draft, items };
}

/** ↑ (−1) / ↓ (+1). */
export function moveItem(draft: BuilderDraft, key: string, delta: -1 | 1): BuilderDraft {
  const index = draft.items.findIndex((i) => i.key === key);
  return index < 0 ? draft : moveItemTo(draft, index, index + delta);
}

/**
 * Drop index of a drag: the dragged card's centre (its top + `dy` + half its height) against the other cards'
 * midpoints. `rects` are the cards' tops and heights before the drag, in order.
 */
export function dropIndex(
  rects: readonly { top: number; height: number }[],
  from: number,
  dy: number,
): number {
  const dragged = rects[from];
  if (!dragged) return from;
  const centre = dragged.top + dy + dragged.height / 2;
  let index = 0;
  for (let i = 0; i < rects.length; i++) {
    if (i === from) continue;
    const r = rects[i] as { top: number; height: number };
    if (centre > r.top + r.height / 2) index += 1;
  }
  return index;
}

export function updateItem(
  draft: BuilderDraft,
  key: string,
  update: (item: WorkoutItem) => WorkoutItem,
): BuilderDraft {
  return { ...draft, items: draft.items.map((i) => (i.key === key ? update(i) : i)) };
}

/** Set count 1–20: new sets copy the last one, fewer drop from the end. */
export function setCount(item: WorkoutItem, count: number): WorkoutItem {
  const n = Math.max(1, Math.min(LIMITS.plannedSets, Math.round(count)));
  const sets = item.sets.slice(0, n);
  const last = item.sets.at(-1);
  while (sets.length < n && last) sets.push({ ...last });
  return { ...item, sets };
}

/** One value for every set («common values»). */
export const setCommon = (item: WorkoutItem, field: SetField, value: number | null): WorkoutItem => ({
  ...item,
  sets: item.sets.map((s) => ({ ...s, [field]: value === null ? null : fitField(field, value) })),
});

/** One value of set `index` («Різні значення для підходів»). */
export const setOne = (
  item: WorkoutItem,
  index: number,
  field: SetField,
  value: number | null,
): WorkoutItem => ({
  ...item,
  sets: item.sets.map((s, i) =>
    i === index ? { ...s, [field]: value === null ? null : fitField(field, value) } : s,
  ),
});

/** Removes set `index` (at least one stays). */
export const removeSet = (item: WorkoutItem, index: number): WorkoutItem =>
  item.sets.length <= 1 ? item : { ...item, sets: item.sets.filter((_, i) => i !== index) };

export const setRest = (item: WorkoutItem, sec: number): WorkoutItem => ({
  ...item,
  restSec: Math.max(LIMITS.restSec.min, Math.min(LIMITS.restSec.max, Math.round(sec))),
});

/** The sets do not all have the same values: the per-set fold opens by default. */
export function setsDiffer(item: Pick<WorkoutItem, 'sets'>): boolean {
  const first = item.sets[0];
  if (!first) return false;
  const key = (s: SetValues) => `${s.reps}|${s.kg}|${s.sec}|${s.min}|${s.km}`;
  return item.sets.some((s) => key(s) !== key(first));
}

/** The value the common stepper shows: the first set's. */
export const commonValue = (item: WorkoutItem, field: SetField): number | null =>
  item.sets[0]?.[field] ?? null;

/** «3 × 12 · 40 кг · відпочинок 1:30» (a missing exercise: «Вправу видалено»). */
export function itemSummary(item: WorkoutItem, exercise: Exercise | undefined): string {
  if (!exercise) return 'Вправу видалено';
  const sets = formatSetsSummary({ kind: exercise.kind, sets: item.sets });
  return item.restSec > 0 ? `${sets} · відпочинок ${clockText(item.restSec)}` : sets;
}

export interface BuilderErrors {
  name?: string;
  items?: string;
}

/** Validation on «Зберегти»: null when it can be saved. */
export function validate(draft: BuilderDraft, own: readonly Exercise[]): BuilderErrors | null {
  const errors: BuilderErrors = {};
  if (!draft.name.trim()) errors.name = NAME_REQUIRED;
  if (!draft.items.some((i) => findExercise(own, i.exerciseId))) errors.items = ITEMS_REQUIRED;
  return errors.name || errors.items ? errors : null;
}

/** The workout to save: name trimmed (single spaces, ≤ 40), days Monday-first, items of missing exercises left out. */
export function toWorkout(draft: BuilderDraft, id: string, own: readonly Exercise[]): Workout {
  const items: WorkoutItem[] = [];
  for (const item of draft.items) {
    const exercise = findExercise(own, item.exerciseId);
    if (!exercise) continue;
    const sets = item.sets.length ? item.sets : [DEFAULT_SET[exercise.kind]];
    items.push({ ...item, sets: sets.slice(0, LIMITS.plannedSets).map((s) => setForKind(exercise.kind, s)) });
  }
  return {
    id,
    name: draft.name.trim().replace(/\s+/g, ' ').slice(0, LIMITS.workoutName),
    days: WEEK_ORDER.filter((d) => draft.days.includes(d)) as Weekday[],
    items: items.slice(0, LIMITS.workoutItems),
  };
}

/** Plan days the save adds (W6), Monday-first: «Чт», «Пт». */
export function addedPlanDays(settings: Settings, days: readonly Weekday[]): Weekday[] {
  const plan = settings.rem.workout.days;
  return WEEK_ORDER.filter((d) => days.includes(d) && !plan.includes(d)) as Weekday[];
}

/** «Збережено» / «Збережено · Чт додано до плану» / «… · Чт, Пт додано до плану». */
export function savedToast(added: readonly Weekday[]): string {
  return added.length
    ? `Збережено · ${added.map((d) => DOW_SHORT[d]).join(', ')} додано до плану`
    : 'Збережено';
}

/** The rule in one sentence (§3.7). */
export const PLAN_RULE = 'Дні тренувань — це твій план у Налаштуваннях → Нагадування.';

/** The note under the weekday picker. */
export function daysNote(settings: Settings): string {
  const rem = settings.rem.workout;
  return rem.on
    ? `У ці дні нагадаю о ${rem.time}. ${PLAN_RULE}`
    : 'Нагадування вимкнено. Ці дні додадуться до плану тренувань.';
}

/** A restored draft, checked field by field (anything malformed → null, the draft is dropped). */
export function parseBuilderDraft(value: unknown): BuilderDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!(v.id === null || typeof v.id === 'string')) return null;
  if (typeof v.name !== 'string' || !Array.isArray(v.days) || !Array.isArray(v.items)) return null;
  const days = v.days.filter(
    (d): d is Weekday => typeof d === 'number' && (WEEK_ORDER as readonly number[]).includes(d),
  );
  const items: WorkoutItem[] = [];
  const nums = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  for (const raw of v.items) {
    if (typeof raw !== 'object' || raw === null) return null;
    const it = raw as Record<string, unknown>;
    if (typeof it.key !== 'string' || typeof it.exerciseId !== 'string' || !Array.isArray(it.sets))
      return null;
    const sets = it.sets.map((s): SetValues => {
      const x = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
      return { reps: nums(x.reps), kg: nums(x.kg), sec: nums(x.sec), min: nums(x.min), km: nums(x.km) };
    });
    if (!sets.length) return null;
    items.push({ key: it.key, exerciseId: it.exerciseId, sets, restSec: nums(it.restSec) ?? 0 });
  }
  return {
    id: v.id,
    name: v.name.slice(0, LIMITS.workoutName),
    days: WEEK_ORDER.filter((d) => days.includes(d)) as Weekday[],
    items,
  };
}
