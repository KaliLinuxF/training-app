import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MUSCLE_LABELS, type Exercise, type WorkoutItem } from '@legko/shared';
import { ExerciseThumb } from '@/features/exercises';
import { Button, cx, Icon, IconButton } from '@/ui';
import {
  commonValue,
  itemSummary,
  removeSet,
  setCommon,
  setCount,
  setOne,
  setRest,
  setsDiffer,
} from './builderModel';
import { CardMenu } from './CardMenu';
import { clockText } from './copy';
import { NumField } from './NumField';
import {
  FIELD_META,
  fieldStep,
  fieldsOf,
  fieldText,
  parseField,
  stepField,
  type SetField,
} from './setFields';
import s from './BuilderItemCard.module.css';

export interface BuilderItemCardProps {
  item: WorkoutItem;
  /** null: her exercise was deleted («Вправу видалено»). */
  exercise: Exercise | undefined;
  index: number;
  count: number;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  onChange: (item: WorkoutItem) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** Drag by the grip (pointer only). */
  onGripDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onGripMove: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onGripUp: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  /** Pixels the card follows the pointer while dragged (null: not dragged). */
  dragOffset: number | null;
}

/** One exercise of the builder (§3.6): collapsed summary, or the editor with one stepper per line. */
export function BuilderItemCard(props: BuilderItemCardProps) {
  const { item, exercise, index, count, expanded, onExpand, onMove } = props;
  const name = exercise?.name ?? 'Вправу видалено';
  const muscles = exercise?.primary.map((m) => MUSCLE_LABELS[m]).join(', ') ?? '';
  return (
    <li
      className={cx(s.card, props.dragOffset !== null && s.dragging)}
      style={props.dragOffset !== null ? { transform: `translateY(${props.dragOffset}px)` } : undefined}
      data-item={item.key}
    >
      <div className={s.head}>
        <span
          className={s.grip}
          aria-hidden="true"
          onPointerDown={props.onGripDown}
          onPointerMove={props.onGripMove}
          onPointerUp={props.onGripUp}
          onPointerCancel={props.onGripUp}
        >
          <Icon name="grip" size={20} />
        </span>
        {exercise ? <ExerciseThumb exercise={exercise} /> : <span className={s.noThumb} aria-hidden="true" />}
        <div className={s.text}>
          <h3 className={s.name}>
            <span className="visually-hidden">{`${index + 1}. `}</span>
            {name}
          </h3>
          <p className={s.summary}>{itemSummary(item, exercise)}</p>
          {muscles && !expanded && <p className="visually-hidden">{muscles}</p>}
        </div>
      </div>
      <div className={s.foot}>
        {exercise && !expanded && (
          <Button
            variant="ghost"
            className={s.change}
            onClick={() => onExpand(true)}
            aria-label={`Змінити: ${name}`}
          >
            Змінити
          </Button>
        )}
        <div className={s.tools}>
          <IconButton
            label={`Вгору: ${name}`}
            shape="step"
            surface="card"
            disabled={index === 0}
            data-move={`${item.key}:up`}
            onClick={() => onMove(-1)}
          >
            <Icon name="arrowUp" size={20} />
          </IconButton>
          <IconButton
            label={`Вниз: ${name}`}
            shape="step"
            surface="card"
            disabled={index === count - 1}
            data-move={`${item.key}:down`}
            onClick={() => onMove(1)}
          >
            <Icon name="arrowDown" size={20} />
          </IconButton>
          <CardMenu
            label={`Дії: ${name}`}
            items={[
              { label: 'Дублювати', onSelect: props.onDuplicate },
              { label: 'Видалити', onSelect: props.onRemove, destructive: true },
            ]}
          />
        </div>
      </div>
      {exercise && expanded && (
        <ItemEditor
          item={item}
          exercise={exercise}
          onChange={props.onChange}
          onDone={() => onExpand(false)}
        />
      )}
    </li>
  );
}

interface ItemEditorProps {
  item: WorkoutItem;
  exercise: Exercise;
  onChange: (item: WorkoutItem) => void;
  onDone: () => void;
}

function ItemEditor({ item, exercise, onChange, onDone }: ItemEditorProps) {
  const [perSet, setPerSet] = useState(() => setsDiffer(item));
  const fields = fieldsOf(exercise.kind);
  const fieldProps = (field: SetField, value: number | null, name: string) => {
    const meta = FIELD_META[field];
    const step = fieldStep(field, exercise.equipment);
    return {
      label: field === 'kg' ? 'Вага, кг' : meta.label,
      name,
      value,
      parse: (t: string) => parseField(field, t),
      format: fieldText,
      step: (v: number | null, sign: -1 | 1) => stepField(field, v, sign * step),
      unit: meta.unit,
      inputMode: meta.inputMode,
    };
  };

  return (
    <div className={s.editor}>
      <NumField
        label="Підходи"
        value={item.sets.length}
        parse={(t) => {
          const n = parseInt(t, 10);
          return Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : undefined;
        }}
        format={(v) => (v === null ? '' : String(v))}
        step={(v, sign) => Math.max(1, Math.min(20, (v ?? 1) + sign))}
        onChange={(v) => onChange(setCount(item, v ?? 1))}
        unit=""
        inputMode="numeric"
      />
      {!perSet &&
        fields.map((field) => (
          <NumField
            key={field}
            {...fieldProps(field, commonValue(item, field), FIELD_META[field].label)}
            onChange={(v) => onChange(setCommon(item, field, v))}
          />
        ))}
      <NumField
        label="Відпочинок"
        value={item.restSec}
        parse={() => undefined}
        format={(v) => clockText(v ?? 0)}
        step={(v, sign) => Math.max(0, Math.min(900, (v ?? 0) + sign * 15))}
        onChange={(v) => onChange(setRest(item, v ?? 0))}
        unit="хв:с"
        inputMode="numeric"
        readOnly
      />
      <Button variant="ghost" className={s.fold} aria-expanded={perSet} onClick={() => setPerSet((o) => !o)}>
        Різні значення для підходів {perSet ? '▴' : '▾'}
      </Button>
      {perSet && (
        <ol className={s.sets}>
          {item.sets.map((set, i) => (
            <li key={i} className={s.set}>
              <div className={s.setHead}>
                <span className={s.setTitle}>Підхід {i + 1}</span>
                {item.sets.length > 1 && (
                  <IconButton
                    label={`Видалити підхід ${i + 1}`}
                    shape="step"
                    surface="card"
                    onClick={() => onChange(removeSet(item, i))}
                  >
                    ✕
                  </IconButton>
                )}
              </div>
              {fields.map((field) => (
                <NumField
                  key={field}
                  {...fieldProps(field, set[field], `${FIELD_META[field].label}, підхід ${i + 1}`)}
                  onChange={(v) => onChange(setOne(item, i, field, v))}
                />
              ))}
            </li>
          ))}
        </ol>
      )}
      <Button variant="outline" onClick={onDone}>
        Готово
      </Button>
    </div>
  );
}
