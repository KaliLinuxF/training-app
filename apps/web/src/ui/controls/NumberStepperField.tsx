import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import { useFieldA11y } from './Field';
import s from './NumberStepperField.module.css';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'value' | 'onChange' | 'type' | 'inputMode' | 'children'
>;

export interface NumberStepperFieldProps extends NativeInputProps {
  /** Raw text of the input («1650», «65,4»); parsing is up to the caller (`num()` from @legko/shared). */
  value: string;
  onChange: (value: string) => void;
  /** Unit shown inside the input on the right («ккал», «кг»). */
  unit: string;
  /** `md` — kcal (height 54, value 24/700); `lg` — weight (height 64, display 30/700). */
  size?: 'md' | 'lg';
  inputMode: 'numeric' | 'decimal';
  /** Text of the side buttons («−50» / «+50», «−0,1» / «+0,1»). */
  decrementText: string;
  incrementText: string;
  onDecrement: () => void;
  onIncrement: () => void;
  /** Accessible names of the side buttons; default to their text. */
  decrementLabel?: string;
  incrementLabel?: string;
}

/** Big numeric input with − / + buttons on the sides (day sheet kcal, weigh-in kg). */
export function NumberStepperField({
  value,
  onChange,
  unit,
  size = 'md',
  inputMode,
  decrementText,
  incrementText,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  ...input
}: NumberStepperFieldProps) {
  const unitId = useId();
  const a11y = useFieldA11y({
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    'aria-describedby': ariaDescribedby,
  });
  const describedBy = [unitId, a11y['aria-describedby']].filter(Boolean).join(' ');
  return (
    <div className={cx(s.field, s[size], className)}>
      <button type="button" className={s.step} onClick={onDecrement} aria-label={decrementLabel}>
        {decrementText}
      </button>
      <div className={s.inputWrap}>
        <input
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          enterKeyHint="done"
          className={s.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={a11y['aria-label']}
          aria-labelledby={a11y['aria-labelledby']}
          aria-describedby={describedBy}
          {...input}
        />
        <span id={unitId} className={s.unit}>
          {unit}
        </span>
      </div>
      <button type="button" className={s.step} onClick={onIncrement} aria-label={incrementLabel}>
        {incrementText}
      </button>
    </div>
  );
}
