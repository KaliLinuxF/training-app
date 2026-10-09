import { useId } from 'react';
import type { Settings } from '@legko/shared';
import { dataActions } from '@/store/data';
import { Card, CardHeader, KeyValueRow, Stepper } from '@/ui';
import { goalRows, stepGoal } from './model';
import s from './GoalsCard.module.css';

/** «Мої цілі» (prototype lines 385–397): target weight ±0,5 kg and daily calories ±50. */
export function GoalsCard({ settings }: { settings: Settings }) {
  const titleId = useId();
  return (
    <Card gap={12} as="section" aria-labelledby={titleId} className={s.card}>
      <CardHeader size="sm" title="Мої цілі" titleId={titleId} />
      {goalRows(settings).map((row) => (
        <KeyValueRow
          key={row.key}
          variant="plain"
          className={s.row}
          label={row.label}
          value={
            <Stepper
              aria-label={row.label}
              className={s.stepper}
              value={row.value}
              decrementLabel={row.decrementLabel}
              incrementLabel={row.incrementLabel}
              canDecrement={row.canDecrement}
              canIncrement={row.canIncrement}
              onDecrement={() => dataActions.updateSettings((st) => stepGoal(st, row.key, -1))}
              onIncrement={() => dataActions.updateSettings((st) => stepGoal(st, row.key, 1))}
            />
          }
        />
      ))}
    </Card>
  );
}
