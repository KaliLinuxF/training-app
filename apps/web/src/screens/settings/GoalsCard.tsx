import type { Settings } from '@legko/shared';
import { dataActions } from '@/store/data';
import { Card, KeyValueRow, Stepper } from '@/ui';
import { goalRows, stepGoal, stepsGoalRow, stepStepsGoal } from './model';
import s from './GoalsCard.module.css';

/**
 * «Мої цілі» (Налаштування → Цілі; prototype lines 385–397): target weight ±0,5 kg, daily calories ±50 and the
 * optional daily steps goal ±500 («Без цілі» when none).
 * No card header: the page title names the section, the region keeps its own name.
 */
export function GoalsCard({ settings }: { settings: Settings }) {
  const steps = stepsGoalRow(settings);
  return (
    <Card gap={12} as="section" aria-label="Мої цілі" className={s.card}>
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
      <KeyValueRow
        variant="plain"
        className={s.row}
        label={steps.label}
        value={
          <Stepper
            aria-label={steps.label}
            className={s.stepper}
            value={steps.value}
            decrementLabel={steps.decrementLabel}
            incrementLabel={steps.incrementLabel}
            canDecrement={steps.canDecrement}
            canIncrement={steps.canIncrement}
            onDecrement={() => dataActions.updateSettings((st) => stepStepsGoal(st, -1))}
            onIncrement={() => dataActions.updateSettings((st) => stepStepsGoal(st, 1))}
          />
        }
      />
    </Card>
  );
}
