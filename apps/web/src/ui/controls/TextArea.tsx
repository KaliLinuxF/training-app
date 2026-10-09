import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import { useFieldA11y } from './Field';
import s from './TextArea.module.css';

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> {
  value: string;
  onChange: (value: string) => void;
  /**
   * Grow with the content from `rows` up to this many rows, then scroll (and keep the end in view
   * when text is appended programmatically, e.g. an AI estimate line). Off by default.
   */
  autoGrowMaxRows?: number;
}

/** Free-text field («Що я їла», «Нотатки»): 16px / 1.45, card background, r16, padding 14, not resizable. */
export function TextArea({
  value,
  onChange,
  rows = 3,
  autoGrowMaxRows,
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
  const ref = useRef<HTMLTextAreaElement>(null);
  const prevLength = useRef(value.length);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !autoGrowMaxRows) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 16 * 1.45;
    const chrome =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    const max = Math.max(rows, autoGrowMaxRows) * line + chrome;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    // Text added from outside (not typed at the caret): show its end.
    const appended = value.length > prevLength.current && document.activeElement !== el;
    if (appended) el.scrollTop = el.scrollHeight;
    prevLength.current = value.length;
  }, [value, rows, autoGrowMaxRows]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(s.textarea, className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...a11y}
      {...rest}
    />
  );
}
