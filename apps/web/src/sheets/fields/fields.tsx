/** Form blocks shared by the record and setup sheets (prototype lines 457–492). */
import { fN, type MeasureKey } from '@legko/shared';
import { useId } from 'react';
import { MEASURE_LABELS } from '@/lib/stats';
import { Field, MeasureInputTile, NumberStepperField } from '@/ui';
import { stepKcal, stepWeight } from '../helpers';
import { digitsOnly, MEASURE_KEYS, type MeasureError, type MeasureTexts } from '../validation';
import s from './fields.module.css';

/** Inline validation message under a control: 13px, `--accD`, announced when it appears. */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <span id={id} className={s.error} role="alert">
      {message}
    </span>
  );
}

const stepText = (step: number): string => fN(step);

export interface WeightFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  /** Starting point of ± when the input is empty (latest weigh-in). */
  base: number | null;
  /** 0,1 for weigh-ins, 0,5 for the goal. */
  step?: number;
  error: string | undefined;
  name?: string;
}

/** «Вага» — big kg input with ± buttons (lg). */
export function WeightField({ label, hint, value, onChange, base, step = 0.1, error, name }: WeightFieldProps) {
  const errId = useId();
  const t = stepText(step);
  return (
    <Field label={label} hint={hint}>
      <NumberStepperField
        size="lg"
        unit="кг"
        inputMode="decimal"
        placeholder="—"
        name={name}
        value={value}
        onChange={onChange}
        decrementText={`−${t}`}
        incrementText={`+${t}`}
        decrementLabel={`Мінус ${t} кг`}
        incrementLabel={`Плюс ${t} кг`}
        onDecrement={() => onChange(stepWeight(value, base, -step))}
        onIncrement={() => onChange(stepWeight(value, base, step))}
        className={error ? s.invalid : undefined}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <FieldError id={errId} message={error} />
    </Field>
  );
}

export interface KcalFieldProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  error: string | undefined;
  name?: string;
}

/** «Калорії за день» — kcal input with −50 / +50 (md), digits only. */
export function KcalField({ label, value, onChange, error, name }: KcalFieldProps) {
  const errId = useId();
  return (
    <Field label={label}>
      <NumberStepperField
        size="md"
        unit="ккал"
        inputMode="numeric"
        placeholder="0"
        name={name}
        maxLength={6}
        value={value}
        onChange={(text) => onChange(digitsOnly(text))}
        decrementText="−50"
        incrementText="+50"
        decrementLabel="Мінус 50 ккал"
        incrementLabel="Плюс 50 ккал"
        onDecrement={() => onChange(stepKcal(value, -50))}
        onIncrement={() => onChange(stepKcal(value, 50))}
        className={error ? s.invalid : undefined}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <FieldError id={errId} message={error} />
    </Field>
  );
}

export interface MeasureFieldProps {
  label: string;
  values: MeasureTexts;
  /** Previous values («74») shown as placeholders. */
  placeholders: MeasureTexts;
  onChange: (key: MeasureKey, text: string) => void;
  error: MeasureError;
}

/** «Заміри» — chest · waist · hips tiles in three columns. */
export function MeasureField({ label, values, placeholders, onChange, error }: MeasureFieldProps) {
  const errId = useId();
  return (
    <Field label={label}>
      <div className={s.measureGrid}>
        {MEASURE_KEYS.map((key) => {
          const invalid = error.invalid.includes(key);
          return (
            <MeasureInputTile
              key={key}
              name={key}
              label={MEASURE_LABELS[key]}
              value={values[key]}
              placeholder={placeholders[key]}
              onChange={(text) => onChange(key, text)}
              className={invalid ? s.tileInvalid : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errId : undefined}
            />
          );
        })}
      </div>
      <FieldError id={errId} message={error.message} />
    </Field>
  );
}
