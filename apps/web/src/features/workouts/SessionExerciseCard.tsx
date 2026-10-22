import { MUSCLE_LABELS, formatSet, type ProgressionHint, type SessionExercise } from '@legko/shared';
import { ExerciseThumb } from '@/features/exercises';
import { Button, cx, Icon } from '@/ui';
import { CardMenu, type CardMenuItem } from './CardMenu';
import { spoken } from './copy';
import { NumField } from './NumField';
import { cardSummary, hintDeltaText, type CardState } from './sessionModel';
import {
  FIELD_META,
  fieldStep,
  fieldsOf,
  fieldText,
  parseField,
  stepField,
  type SetField,
} from './setFields';
import s from './SessionExerciseCard.module.css';

export interface SessionExerciseCardProps {
  ex: SessionExercise;
  state: CardState;
  /** Body shown (the current card always, others when she opens them; every card in the edit mode). */
  expanded: boolean;
  /** Toggles a collapsed card open (absent: the card cannot collapse — current / edit mode). */
  onToggleExpanded?: () => void;
  /** false: another device writes this session (no ✓, no steppers, no menu). */
  editable: boolean;
  /** The set whose editor is open (null: none). */
  editIndex: number | null;
  /** «Минулого разу: 3 × 10 · 35 кг» (live only). */
  lastSummary?: string | null;
  /** The progression hint (live only), its state and actions. */
  hint?: ProgressionHint | null;
  hintApplied?: boolean;
  onHint?: () => void;
  onHintUndo?: () => void;
  onToggleSet: (index: number) => void;
  onSelectSet: (index: number) => void;
  onUpdate: (index: number, field: SetField, value: number | null) => void;
  onAddSet: () => void;
  onRemoveSet: (index: number) => void;
  onSkip: (skipped: boolean) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}

/** One exercise of a session (§3.9): done / current / upcoming / skipped, its sets with ✓ and the set editor. */
export function SessionExerciseCard(props: SessionExerciseCardProps) {
  const { ex, state, expanded, editable, editIndex } = props;
  const done = ex.sets.filter((x) => x.done).length;
  const headingId = `entry-${ex.key}`;
  const menu: CardMenuItem[] = [
    ex.skipped
      ? { label: 'Повернути', onSelect: () => props.onSkip(false) }
      : { label: 'Пропустити вправу', onSelect: () => props.onSkip(true) },
    { label: 'Прибрати з тренування', onSelect: props.onRemove, destructive: true },
    { label: 'Вгору', onSelect: () => props.onMove(-1), disabled: props.isFirst },
    { label: 'Вниз', onSelect: () => props.onMove(1), disabled: props.isLast },
  ];
  const status = ex.skipped ? 'Пропущено' : state === 'done' ? `✓ ${done}/${ex.sets.length}` : null;

  return (
    <li
      className={cx(s.card, s[state])}
      data-entry={ex.key}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <div className={s.head}>
        <ExerciseThumb exercise={ex} />
        <div className={s.headText}>
          <h2 id={headingId} className={s.name}>
            {props.onToggleExpanded ? (
              <button
                type="button"
                className={s.toggle}
                aria-expanded={expanded}
                onClick={props.onToggleExpanded}
              >
                {ex.name}
              </button>
            ) : (
              ex.name
            )}
          </h2>
          {(!expanded || ex.skipped) && <p className={s.summary}>{cardSummary(ex, state)}</p>}
        </div>
        {status && state !== 'skipped' && (
          <span className={s.status}>
            <span aria-hidden="true">{status}</span>
            <span className="visually-hidden">{`Виконано ${done} з ${ex.sets.length}`}</span>
          </span>
        )}
        {editable && <CardMenu className={s.menu} label={`Дії: ${ex.name}`} items={menu} />}
      </div>

      {ex.skipped && editable && (
        <Button variant="ghost" className={s.unskip} onClick={() => props.onSkip(false)}>
          Повернути
        </Button>
      )}

      {expanded && !ex.skipped && (
        <div className={s.body}>
          {ex.primary.length > 0 && (
            <p className={s.muscles}>
              {ex.primary
                .map((m, i) => (i === 0 ? MUSCLE_LABELS[m] : MUSCLE_LABELS[m].toLocaleLowerCase('uk')))
                .join(', ')}
            </p>
          )}
          {props.lastSummary && <p className={s.last}>Минулого разу: {props.lastSummary}</p>}
          {editable && props.hint && (props.hintApplied || ex.sets.some((x) => !x.done)) && (
            <div className={s.hint}>
              {props.hintApplied ? (
                <p className={s.hintApplied}>
                  {hintDeltaText(props.hint)} додано ·{' '}
                  <Button variant="ghost" className={s.inline} onClick={props.onHintUndo}>
                    Скасувати
                  </Button>
                </p>
              ) : (
                <Button variant="ghost" className={s.inline} onClick={props.onHint}>
                  Спробувати {hintDeltaText(props.hint)}
                </Button>
              )}
            </div>
          )}

          <ol className={s.sets} aria-label={`Підходи: ${ex.name}`}>
            {ex.sets.map((set, i) => (
              <li key={i} className={cx(s.set, set.done && s.setDone, editIndex === i && s.editing)}>
                <span className={s.num} aria-hidden="true">
                  {i + 1}
                </span>
                {editIndex === i && editable ? (
                  <SetEditor
                    ex={ex}
                    index={i}
                    onUpdate={props.onUpdate}
                    onRemove={ex.sets.length > 1 ? () => props.onRemoveSet(i) : undefined}
                  />
                ) : editable ? (
                  <button
                    type="button"
                    className={s.value}
                    aria-label={`Змінити підхід ${i + 1}: ${spoken(formatSet(ex.kind, set))}`}
                    onClick={() => props.onSelectSet(i)}
                  >
                    {formatSet(ex.kind, set)}
                  </button>
                ) : (
                  <span className={s.value}>{formatSet(ex.kind, set)}</span>
                )}
                {editable ? (
                  <button
                    type="button"
                    className={cx(s.check, set.done && s.checked)}
                    aria-pressed={set.done}
                    aria-label={`Підхід ${i + 1} виконано`}
                    onClick={() => props.onToggleSet(i)}
                  >
                    {set.done && <Icon name="check" size={22} />}
                  </button>
                ) : (
                  <span className={cx(s.check, set.done && s.checked)}>
                    {set.done && <Icon name="check" size={22} />}
                    <span className="visually-hidden">{set.done ? 'виконано' : 'не виконано'}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {editable && (
            <Button variant="outline" size="sm" className={s.addSet} onClick={props.onAddSet}>
              + Підхід
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

interface SetEditorProps {
  ex: SessionExercise;
  index: number;
  onUpdate: (index: number, field: SetField, value: number | null) => void;
  onRemove?: () => void;
}

/** The set being edited: one big stepper per field (≥ 44 px), «Видалити підхід». */
function SetEditor({ ex, index, onUpdate, onRemove }: SetEditorProps) {
  const set = ex.sets[index];
  if (!set) return null;
  return (
    <div className={s.editor}>
      {fieldsOf(ex.kind).map((field) => {
        const meta = FIELD_META[field];
        const step = fieldStep(field, ex.equipment);
        return (
          <NumField
            key={field}
            label={meta.label}
            name={`${meta.label}, підхід ${index + 1}`}
            value={set[field]}
            parse={(t) => parseField(field, t)}
            format={fieldText}
            step={(v, sign) => stepField(field, v, sign * step)}
            onChange={(v) => onUpdate(index, field, v)}
            unit={meta.unit}
            inputMode={meta.inputMode}
          />
        );
      })}
      {onRemove && (
        <Button variant="ghost" className={s.removeSet} onClick={onRemove}>
          Видалити підхід
        </Button>
      )}
    </div>
  );
}
