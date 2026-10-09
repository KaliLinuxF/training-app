import type { ReactNode } from 'react';
import { Button, ListGroup, ListRow, Pill, TrainingToggle, type ListRowProps } from '@/ui';
import type { HomeFoodRow, HomeModel, HomeRowId, HomeScheduleRow } from './homeModel';
import s from './TodayCard.module.css';

export interface TodayCardProps {
  rows: HomeModel['rows'];
  /** A row was tapped: open its short sheet for today. */
  onOpen: (id: HomeRowId) => void;
  /** «Відкрити день →»: today's full «Запис дня». */
  onOpenDay: () => void;
  /** Inline «✓ Було» (`true`) / «✕ Не було» (`false`): saves at once. */
  onTrained: (trained: boolean) => void;
  className?: string;
}

const PREFIX_TONE: Record<'acc' | 'acc2', string | undefined> = { acc: s.toneAcc, acc2: s.toneAcc2 };

function foodValue(food: HomeFoodRow): ReactNode {
  if (food.state === 'recorded') return food.value;
  return (
    <>
      <span className={s.kcal}>{food.value}</span>
      {food.goal !== null && <span className={s.goal}>{food.goal}</span>}
    </>
  );
}

function scheduleSub(row: HomeScheduleRow): ReactNode {
  if (!row.prefix) return row.sub;
  return (
    <>
      <span className={PREFIX_TONE[row.prefix.tone]}>{row.prefix.text}</span>
      {row.sub}
    </>
  );
}

/** Value, variant and tone of the Вага / Заміри rows: a «Сьогодні» pill, the next date, or «вимкнено». */
function scheduleValue(row: HomeScheduleRow): Pick<ListRowProps, 'value' | 'valueVariant' | 'valueTone'> {
  if (row.next.kind === 'due') {
    return {
      value: (
        <Pill tone="acc" size="sm">
          {row.next.text}
        </Pill>
      ),
    };
  }
  return {
    value: row.next.text,
    valueVariant: 'soft',
    valueTone: row.next.kind === 'off' ? 'muted' : undefined,
  };
}

/**
 * «Сьогодні»: four action rows (Їжа, Тренування with the inline ✓ / ✕, Вага, Заміри), each opening its short sheet,
 * and «Відкрити день →» for the full day. The toggle is a sibling of the row button, never inside it.
 */
export function TodayCard({ rows, onOpen, onOpenDay, onTrained, className }: TodayCardProps) {
  const { food, workout, weight, measure } = rows;
  return (
    <ListGroup
      title="Сьогодні"
      className={className}
      headerRight={
        <Button variant="ghost" aria-label="Відкрити день" aria-haspopup="dialog" onClick={onOpenDay}>
          Відкрити день →
        </Button>
      }
    >
      <ListRow
        icon="food"
        iconTone="acc2"
        title="Їжа"
        sub={food.sub ?? undefined}
        subTone={food.sub !== null ? 'acc' : undefined}
        meter={food.meter ?? undefined}
        value={foodValue(food)}
        valueVariant={food.state === 'recorded' ? 'soft' : 'strong'}
        valueTone={food.state === 'over' ? 'acc' : food.state === 'reached' ? 'acc2' : undefined}
        aria-label={food.label}
        aria-haspopup="dialog"
        onClick={() => onOpen('food')}
      />
      <ListRow
        icon="workout"
        iconTone="acc"
        title="Тренування"
        sub={workout.sub}
        subTone={workout.subTone}
        chevron={false}
        aria-label={workout.label}
        aria-haspopup="dialog"
        onClick={() => onOpen('workout')}
        trailing={
          <TrainingToggle
            size="sm"
            value={workout.trained}
            onChange={onTrained}
            aria-label="Тренування сьогодні"
          />
        }
      />
      <ListRow
        icon="weight"
        iconTone="neutral"
        title="Вага"
        sub={scheduleSub(weight)}
        {...scheduleValue(weight)}
        aria-label={weight.label}
        aria-haspopup="dialog"
        onClick={() => onOpen('weight')}
      />
      <ListRow
        icon="measure"
        iconTone="neutral"
        title="Заміри"
        sub={scheduleSub(measure)}
        {...scheduleValue(measure)}
        aria-label={measure.label}
        aria-haspopup="dialog"
        onClick={() => onOpen('measure')}
      />
    </ListGroup>
  );
}
