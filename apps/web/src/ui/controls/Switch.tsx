import { cx } from '../internal/cx';
import s from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Give the switch a name: either a label or the id of the visible title. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** iOS-style switch 52×32 (on = `--acc2`, off = `--line3`), knob slides. */
export function Switch({ checked, onChange, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(s.switch, checked && s.on, className)}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className={s.knob} aria-hidden="true" />
    </button>
  );
}
