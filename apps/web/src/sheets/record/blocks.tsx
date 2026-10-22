/**
 * Form blocks of the record sheet. The full «Запис дня» shows the workout and the notes (its food is the meal list,
 * `FoodDayPanel`, each meal saving on its own); «Тренування» shows the workout and the folded notes.
 */
import { LIMITS } from '@legko/shared';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Field, Pill, TextArea, TrainingToggle } from '@/ui';
import { FieldError } from '../fields/fields';
import type { RecordDraft, RecordErrors, RecordMode } from './model';
import { JUST_MARK_LABEL, TYPES_NOTES_LABEL } from './workoutSheetModel';
import { TypePicker } from './TypePicker';
import s from './blocks.module.css';

const NOTES_MAX_ROWS = 6;

export const NOTES_LABEL = 'Нотатки';
/** The folded notes in «Тренування». */
export const ADD_NOTE_LABEL = '+ Нотатка до дня';

type SetDraft = (patch: Partial<RecordDraft>) => void;

export interface WorkoutBlockProps {
  mode: RecordMode;
  draft: RecordDraft;
  errors: RecordErrors;
  set: SetDraft;
  customTypes: readonly string[];
  /**
   * - `toggle` — ✓ / ✕ as always (default);
   * - `labelled` — «Тренування» with the workouts above it: the toggle under «Або просто відміть»;
   * - `recorded` — the day has a done session (W5): no ✓ / ✕ (it cannot contradict the session), a static «✓ Було»
   *   mark in «Запис дня», the types under «Типи і нотатки» in «Тренування».
   */
  marking?: 'toggle' | 'labelled' | 'recorded';
}

/** The static mark that replaces ✓ / ✕ on a day with a done session (read as «Тренування записано»). */
export function RecordedMark() {
  return (
    <span className={s.recorded}>
      <Pill tone="acc2" size="sm">
        <span aria-hidden="true">✓ Було</span>
        <span className="visually-hidden">Тренування записано</span>
      </Pill>
    </span>
  );
}

/**
 * ✓ Було / ✕ Не було (lg) and, once trained, the type chips. In «Запис дня» it sits in the field
 * «Тренування»; in «Тренування» the heading names it (the toggle group keeps the name «Тренування»)
 * and the chips get a «Тип» label. «✕» drops the types.
 */
export function WorkoutBlock({ mode, draft, errors, set, customTypes, marking = 'toggle' }: WorkoutBlockProps) {
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
        {marking === 'recorded' ? <RecordedMark /> : toggle}
        {picker}
        {error}
      </Field>
    );
  }
  if (marking === 'recorded') {
    return picker ? (
      <Field label={TYPES_NOTES_LABEL}>
        {picker}
        {error}
      </Field>
    ) : null;
  }
  return (
    <>
      {marking === 'labelled' ? <Field label={JUST_MARK_LABEL}>{toggle}</Field> : toggle}
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
