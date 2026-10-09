/** Form blocks shared by the record and setup sheets (prototype lines 457–492). */
import { fN, num, type MeasureKey } from '@legko/shared';
import { useId } from 'react';
import { KcalGoalLine, kcalGoalView } from '@/features/goal';
import { MEASURE_LABELS } from '@/lib/stats';
import { Button, Field, MeasureInputTile, NumberStepperField } from '@/ui';
import { stepKcal, stepWeight, type StepRange } from '../helpers';
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

/** Shown above «Зберегти» when the store refused the save (nothing was applied, the draft stays). */
export const SAVE_FAILED = 'Не вдалося зберегти — перевір дані й спробуй ще раз';

export interface SaveFooterProps {
  label: string;
  onSave: () => void;
  disabled: boolean;
  /** Message above the button (e.g. `SAVE_FAILED`). */
  error?: string;
}

/** Sheet footer: full-width «Зберегти» / «Почати» (lg) with an optional inline error above it. */
export function SaveFooter({ label, onSave, disabled, error }: SaveFooterProps) {
  const errId = useId();
  return (
    <div className={s.footer}>
      <FieldError id={errId} message={error} />
      <Button size="lg" fullWidth onClick={onSave} disabled={disabled} aria-describedby={error ? errId : undefined}>
        {label}
      </Button>
    </div>
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
  /** ± never leaves these bounds (the goal). */
  range?: StepRange;
  error: string | undefined;
  name?: string;
}

/** «Вага» — big kg input with ± buttons (lg). */
export function WeightField({ label, hint, value, onChange, base, step = 0.1, range, error, name }: WeightFieldProps) {
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
        onDecrement={() => onChange(stepWeight(value, base, -step, range))}
        onIncrement={() => onChange(stepWeight(value, base, step, range))}
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
  /** ± never leaves these bounds (the daily goal). */
  range?: StepRange;
  error: string | undefined;
  name?: string;
  /** Daily kcal goal: shows a live «Залишилось … / Перевищено …» line under the field. */
  goal?: number;
}

/** «Калорії за день» — kcal input with −50 / +50 (md), digits only. */
export function KcalField({ label, value, onChange, range, error, name, goal }: KcalFieldProps) {
  const errId = useId();
  const hint = goal != null && !error ? <KcalGoalLine view={kcalGoalView(num(value), goal)} /> : undefined;
  return (
    <Field label={label} hint={hint}>
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
        onDecrement={() => onChange(stepKcal(value, -50, range))}
        onIncrement={() => onChange(stepKcal(value, 50, range))}
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
