import { cx } from '../internal/cx';
import s from './QuickAction.module.css';

export interface QuickActionProps {
  /** «Харчування», «Тренування», «Вага», «Заміри». */
  label: string;
  /** Small line above the label. */
  caption?: string;
  /** Background of the «+» square: `acc2` mint tint, `acc` lavender tint, `neutral` `--line2`. */
  tone?: 'acc' | 'acc2' | 'neutral';
  onClick: () => void;
  className?: string;
}

/** Home quick button «+ Додати …» (card, r20, min-height 64). */
export function QuickAction({
  label,
  caption = 'Додати',
  tone = 'neutral',
  onClick,
  className,
}: QuickActionProps) {
  return (
    <button type="button" className={cx(s.action, className)} onClick={onClick}>
      <span className={cx(s.icon, s[tone])} aria-hidden="true">
        +
      </span>
      <span className={s.text}>
        <span className={s.caption}>{caption}</span>
        <span className={s.label}>{label}</span>
      </span>
    </button>
  );
}
