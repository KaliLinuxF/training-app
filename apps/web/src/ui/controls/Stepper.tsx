import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import { IconButton } from './IconButton';
import s from './Stepper.module.css';

export interface StepperProps {
  /** Formatted current value («60,0 кг», «1 700 ккал»). */
  value: ReactNode;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel?: string;
  incrementLabel?: string;
  canDecrement?: boolean;
  canIncrement?: boolean;
  /** Accessible name of the whole control («Цільова вага»). */
  'aria-label'?: string;
  className?: string;
}

/** «− value +» control from «Мої цілі»: 44px step buttons, value 17/700 centred (min-width 96). */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  decrementLabel = 'Зменшити',
  incrementLabel = 'Збільшити',
  canDecrement = true,
  canIncrement = true,
  className,
  'aria-label': ariaLabel,
}: StepperProps) {
  return (
    <div role="group" aria-label={ariaLabel} className={cx(s.stepper, className)}>
      <IconButton label={decrementLabel} shape="step" onClick={onDecrement} disabled={!canDecrement}>
        −
      </IconButton>
      <output className={s.value} aria-live="polite">
        {value}
      </output>
      <IconButton label={incrementLabel} shape="step" onClick={onIncrement} disabled={!canIncrement}>
        +
      </IconButton>
    </div>
  );
}
