/**
 * Form blocks of the record sheet. The full «Запис дня» shows them all; the short sheets show one
 * action's blocks («Їжа»: food + kcal; «Тренування»: workout + folded notes).
 */
import { LIMITS, type AppData, type ISODate } from '@legko/shared';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { FoodAssist, PhotoStrip, type FoodAdd } from '@/features/food';
import { Button, Field, TextArea, TrainingToggle } from '@/ui';
import { FieldError, KcalField } from '../fields/fields';
import { applyFoodAdd, removePhoto, type RecordDraft, type RecordErrors, type RecordMode } from './model';
import { TypePicker } from './TypePicker';
import s from './blocks.module.css';

/** Food text grows up to this many rows before it scrolls (estimate lines make it long). */
const FOOD_MAX_ROWS = 8;
const NOTES_MAX_ROWS = 6;

/** Name of the food text (a visible label in «Запис дня», `aria-label` in «Їжа»). */
export const FOOD_LABEL = 'Що я їла';
export const NOTES_LABEL = 'Нотатки';
/** The folded notes in «Тренування». */
export const ADD_NOTE_LABEL = '+ Нотатка до дня';

type SetDraft = (patch: Partial<RecordDraft>) => void;
type UpdateDraft = (change: (draft: RecordDraft) => RecordDraft) => void;

export interface FoodBlockProps {
  mode: RecordMode;
  draft: RecordDraft;
  errors: RecordErrors;
  set: SetDraft;
  update: UpdateDraft;
  /** FoodAssist reports an estimate on screen / text in its composer (unsaved work). */
  onFoodPending: (pending: boolean) => void;
  /** `SheetState.key`: FoodAssist starts afresh for every opened sheet. */
  sheetKey: number;
  date: ISODate;
  data: AppData;
}

/**
 * «Що я їла» + photos + FoodAssist (estimate, «Часті страви»), then «Калорії за день» with the goal.
 * In «Їжа» the text has no visible label: the sheet heading says it.
 */
export function FoodBlock({
  mode,
  draft,
  errors,
  set,
  update,
  onFoodPending,
  sheetKey,
  date,
  data,
}: FoodBlockProps) {
  const errId = useId();
  const labelled = mode === 'day';
  const content = (
    <>
      <TextArea
        rows={3}
        autoGrowMaxRows={FOOD_MAX_ROWS}
        maxLength={LIMITS.text}
        name="food"
        placeholder="Сніданок, обід, вечеря, перекуси…"
        value={draft.food}
        onChange={(food) => set({ food })}
        aria-label={labelled ? undefined : FOOD_LABEL}
        aria-invalid={errors.food ? true : undefined}
        aria-errormessage={errors.food ? errId : undefined}
      />
      <FieldError id={errId} message={errors.food} />
      <PhotoStrip ids={draft.photos} size="md" onRemove={(id) => update((d) => removePhoto(d, id))} />
      <FoodAssist
        key={sheetKey}
        date={date}
        foodText={draft.food}
        onAdd={(add: FoodAdd) => update((d) => applyFoodAdd(d, add))}
        onPendingChange={onFoodPending}
      />
    </>
  );
  return (
    <>
      {labelled ? <Field label={FOOD_LABEL}>{content}</Field> : <div className={s.stack}>{content}</div>}
      <KcalField
        label="Калорії за день"
        name="kcal"
        value={draft.kcal}
        onChange={(kcal) => set({ kcal })}
        error={errors.kcal}
        goal={data.settings.kcalGoal}
      />
    </>
  );
}

export interface WorkoutBlockProps {
  mode: RecordMode;
  draft: RecordDraft;
  errors: RecordErrors;
  set: SetDraft;
  customTypes: readonly string[];
}

/**
 * ✓ Було / ✕ Не було (lg) and, once trained, the type chips. In «Запис дня» it sits in the field
 * «Тренування»; in «Тренування» the heading names it (the toggle group keeps the name «Тренування»)
 * and the chips get a «Тип» label. «✕» drops the types.
 */
export function WorkoutBlock({ mode, draft, errors, set, customTypes }: WorkoutBlockProps) {
  const errId = useId();
  const onTrained = (trained: boolean) => set(trained ? { trained } : { trained, types: [] });
  const toggle = <TrainingToggle size="lg" value={draft.trained} onChange={onTrained} />;
  const picker = draft.trained === true && (
    <TypePicker selected={draft.types} customTypes={customTypes} onChange={(types) => set({ types })} />
  );
  const error = <FieldError id={errId} message={errors.types} />;

  if (mode === 'day') {
    return (
      <Field label="Тренування">
        {toggle}
        {picker}
        {error}
      </Field>
    );
  }
  return (
    <>
      {toggle}
      {picker && (
        <Field label="Тип">
          {picker}
          {error}
        </Field>
      )}
    </>
  );
}

export interface NotesBlockProps {
  value: string;
  onChange: (notes: string) => void;
  error: string | undefined;
  /** «Тренування»: folded into «+ Нотатка до дня» while the day has no notes. */
  foldable: boolean;
  /** The day had notes when the sheet loaded them: stays open even when she clears the text. */
  hadNotes: boolean;
  /** `SheetState.key`: an opened fold belongs to that sheet (‹ › to another day folds it again). */
  sheetKey: number;
}

/** «Нотатки» (2 rows, grows to 6). Folded, a ghost «+ Нотатка до дня» opens it and focuses the text. */
export function NotesBlock({ value, onChange, error, foldable, hadNotes, sheetKey }: NotesBlockProps) {
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  const inputId = useId();
  const errId = useId();

  if (foldable && openedFor !== sheetKey && !hadNotes && value === '') {
    // Rendered and focused inside the tap, so the iPhone keyboard opens with it.
    const reveal = () => {
      flushSync(() => setOpenedFor(sheetKey));
      document.getElementById(inputId)?.focus();
    };
    return (
      <Button variant="ghost" className={s.addNote} onClick={reveal}>
        {ADD_NOTE_LABEL}
      </Button>
    );
  }
  return (
    <Field label={NOTES_LABEL}>
      <TextArea
        id={inputId}
        rows={2}
        autoGrowMaxRows={NOTES_MAX_ROWS}
        maxLength={LIMITS.text}
        name="notes"
        placeholder="Самопочуття, вода, сон…"
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <FieldError id={errId} message={error} />
    </Field>
  );
}
