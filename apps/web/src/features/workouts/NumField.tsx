import { useState } from 'react';
import { Field, NumberStepperField } from '@/ui';

export interface NumFieldProps {
  /** Visible label above the stepper («Повторення», «Вага»). */
  label: string;
  /** Spoken base of the side buttons («Повторення, підхід 2» → «… : менше»); default `label`. */
  name?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Typed text → value; null = empty, undefined = not a number (ignored while typing). */
  parse: (text: string) => number | null | undefined;
  /** Value → input text. */
  format: (value: number | null) => string;
  /** The value one press away (`sign` −1 / +1). */
  step: (value: number | null, sign: -1 | 1) => number | null;
  unit: string;
  inputMode: 'numeric' | 'decimal';
  /** The input only shows the value (rest «1:30»): the buttons change it. */
  readOnly?: boolean;
  className?: string;
}

/**
 * One kit `NumberStepperField` on its own full-width line with the label above (§3.6: the kit field is
 * 54 + 1fr + 54 px, two side by side do not fit on any iPhone). Typing is kept as typed («42,» stays) and the value is
 * reported as soon as it parses; a stepper press or a new value from outside rewrites the text.
 */
export function NumField({
  label,
  name = label,
  value,
  onChange,
  parse,
  format,
  step,
  unit,
  inputMode,
  readOnly,
  className,
}: NumFieldProps) {
  const [text, setText] = useState(() => format(value));
  const [shown, setShown] = useState(value);
  if (!Object.is(value, shown)) {
    setShown(value);
    setText(format(value));
  }
  const press = (sign: -1 | 1) => onChange(step(value, sign));
  return (
    <Field label={label} className={className}>
      <NumberStepperField
        value={text}
        onChange={(t) => {
          setText(t);
          const v = parse(t);
          if (v === undefined) return;
          setShown(v);
          onChange(v);
        }}
        onBlur={() => setText(format(value))}
        aria-label={name !== label ? name : undefined}
        unit={unit}
        inputMode={inputMode}
        readOnly={readOnly}
        decrementText="−"
        incrementText="+"
        decrementLabel={`${name}: менше`}
        incrementLabel={`${name}: більше`}
        onDecrement={() => press(-1)}
        onIncrement={() => press(1)}
      />
    </Field>
  );
}
