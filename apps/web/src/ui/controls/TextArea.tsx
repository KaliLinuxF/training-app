import type { TextareaHTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import { useFieldA11y } from './Field';
import s from './TextArea.module.css';

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> {
  value: string;
  onChange: (value: string) => void;
}

/** Free-text field («Що я їла», «Нотатки»): 16px / 1.45, card background, r16, padding 14, not resizable. */
export function TextArea({
  value,
  onChange,
  rows = 3,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  ...rest
}: TextAreaProps) {
  const a11y = useFieldA11y({
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    'aria-describedby': ariaDescribedby,
  });
  return (
    <textarea
      rows={rows}
      className={cx(s.textarea, className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...a11y}
      {...rest}
    />
  );
}
