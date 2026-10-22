import { useEffect, useId, useRef, useState } from 'react';
import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  EXERCISE_KIND_LABELS,
  EXERCISE_KINDS,
  INTENSITIES,
  INTENSITY_LABELS,
  type Exercise,
  type MuscleId,
} from '@legko/shared';
import { dataActions, newId, useAppData } from '@/store/data';
import { Button, Chip, ChipGroup, Field, Segmented, Sheet, useFieldA11y } from '@/ui';
import { BodyMap, TAP_OUTLINE_MS } from './BodyMap';
import { cycleMuscle, type MuscleState } from './bodyMapModel';
import {
  draftOf,
  exerciseFromDraft,
  hasErrors,
  NAME_MAX,
  SAVE_FAILED,
  validateDraft,
  type ExerciseDraft,
} from './editorModel';
import { MuscleChips } from './MuscleChips';
import s from './ExerciseEditorSheet.module.css';

export interface ExerciseEditorSheetProps {
  open: boolean;
  /** Her exercise to edit; without it a new one is created. */
  exercise?: Exercise;
  /** Pre-fills the name of a new exercise (the library search). */
  initialName?: string;
  /** Called with the saved exercise; the sheet then closes itself (`onClose`). */
  onSaved: (exercise: Exercise) => void;
  onClose: () => void;
}

const KIND_OPTIONS = EXERCISE_KINDS.map((k) => ({ value: k, label: EXERCISE_KIND_LABELS[k] }));
const INTENSITY_OPTIONS = INTENSITIES.map((i) => ({ value: i, label: INTENSITY_LABELS[i] }));
export const MUSCLES_HINT = 'Торкнись мʼяза: раз — основний, двічі — допоміжний, втретє — прибрати';

/**
 * «Нова вправа» / «Вправа»: her own exercise — name, kind, muscles (tappable map + chips), equipment, intensity.
 * A kit Sheet, so it stacks over the library page or the picker sheet.
 */
export function ExerciseEditorSheet({ open, exercise, initialName, onSaved, onClose }: ExerciseEditorSheetProps) {
  // A fresh draft every time it opens (derived from the props while rendering, no effect).
  const [opened, setOpened] = useState(open);
  const [generation, setGeneration] = useState(0);
  if (open !== opened) {
    setOpened(open);
    if (open) setGeneration((g) => g + 1);
  }
  const formId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      heading={exercise ? 'Вправа' : 'Нова вправа'}
      footer={
        <Button size="lg" fullWidth type="submit" form={formId}>
          Зберегти
        </Button>
      }
    >
      <EditorForm
        key={generation}
        formId={formId}
        exercise={exercise}
        initialName={initialName}
        onSaved={(ex) => {
          onSaved(ex);
          onClose();
        }}
      />
    </Sheet>
  );
}

interface EditorFormProps {
  formId: string;
  exercise?: Exercise;
  initialName?: string;
  onSaved: (exercise: Exercise) => void;
}

function EditorForm({ formId, exercise, initialName, onSaved }: EditorFormProps) {
  const own = useAppData().exercises;
  const [draft, setDraft] = useState<ExerciseDraft>(() => draftOf(exercise, initialName));
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapped, setTapped] = useState<MuscleId | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const errors = submitted ? validateDraft(draft, own, exercise?.id) : {};
  const errorId = useId();
  const nameErrorId = `${errorId}-name`;
  const musclesErrorId = `${errorId}-muscles`;

  const patch = (next: Partial<ExerciseDraft>) => {
    setFailed(false);
    setDraft((d) => ({ ...d, ...next }));
  };
  const setMuscles = (next: MuscleState) => patch({ primary: next.primary, secondary: next.secondary });

  const onRegionTap = (m: MuscleId) => {
    setMuscles(cycleMuscle(draft, m));
    setTapped(m);
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapped(null), TAP_OUTLINE_MS);
  };

  const save = () => {
    setSubmitted(true);
    const found = validateDraft(draft, own, exercise?.id);
    if (hasErrors(found)) {
      const first = document.getElementById(found.name ? `${formId}-name` : `${formId}-muscles`);
      first?.focus({ preventScroll: false });
      return;
    }
    const saved = exerciseFromDraft(draft, exercise?.id ?? newId());
    if (!dataActions.saveExercise(saved)) {
      setFailed(true);
      return;
    }
    onSaved(saved);
  };

  return (
    <form
      id={formId}
      className={s.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Назва">
        <NameInput
          id={`${formId}-name`}
          value={draft.name}
          onChange={(name) => patch({ name })}
          errorId={errors.name ? nameErrorId : undefined}
        />
        {errors.name && (
          <span id={nameErrorId} className={s.error} role="alert">
            {errors.name}
          </span>
        )}
      </Field>

      <Field label="Тип">
        <Segmented
          options={KIND_OPTIONS}
          value={draft.kind}
          onChange={(kind) => patch({ kind })}
          aria-label="Тип"
          className={s.segmented}
        />
      </Field>

      <Field label="Мʼязи" hint={MUSCLES_HINT}>
        <BodyMap
          primary={draft.primary}
          secondary={draft.secondary}
          size="lg"
          onRegionTap={onRegionTap}
          className={s.map}
        />
        <div id={`${formId}-muscles`} tabIndex={-1} className={s.chipsAnchor}>
          <MuscleChips
            primary={draft.primary}
            secondary={draft.secondary}
            onChange={setMuscles}
            highlight={tapped}
          />
        </div>
        {errors.muscles && (
          <span id={musclesErrorId} className={s.error} role="alert">
            {errors.muscles}
          </span>
        )}
      </Field>

      <Field label="Обладнання">
        <ChipGroup>
          {EQUIPMENT.map((eq) => (
            <Chip key={eq} selected={draft.equipment === eq} onClick={() => patch({ equipment: eq })}>
              {EQUIPMENT_LABELS[eq]}
            </Chip>
          ))}
        </ChipGroup>
      </Field>

      <Field label="Інтенсивність">
        <Segmented
          options={INTENSITY_OPTIONS}
          value={draft.intensity}
          onChange={(intensity) => patch({ intensity })}
          aria-label="Інтенсивність"
        />
      </Field>

      {failed && (
        <p className={s.error} role="alert">
          {SAVE_FAILED}
        </p>
      )}
    </form>
  );
}

interface NameInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  errorId?: string;
}

function NameInput({ id, value, onChange, errorId }: NameInputProps) {
  const a11y = useFieldA11y({});
  return (
    <input
      id={id}
      type="text"
      className={s.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={NAME_MAX}
      placeholder="Наприклад, Степ-аеробіка"
      autoComplete="off"
      enterKeyHint="done"
      aria-labelledby={a11y['aria-labelledby']}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={errorId}
    />
  );
}
