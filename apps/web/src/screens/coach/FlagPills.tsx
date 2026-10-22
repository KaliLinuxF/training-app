import { cx, Pill } from '@/ui';
import type { PillModel } from './clientsModel';
import s from './FlagPills.module.css';

export interface FlagPillsProps {
  pills: readonly PillModel[];
  /** For `aria-describedby` (the phone list row). */
  id?: string;
  /**
   * The pills sit on the page background (the client header), not on a card: the kit's neutral pill is filled with
   * `--paper` and would vanish, so neutral pills get a card fill with a hairline ring.
   */
  onPaper?: boolean;
  className?: string;
}

/** Attention flags (lavender) and account status pills (neutral) under a client's name; nothing when there are none. */
export function FlagPills({ pills, id, onPaper = false, className }: FlagPillsProps) {
  if (pills.length === 0) return null;
  return (
    <span id={id} className={cx(s.pills, className)}>
      {pills.map((pill) => (
        <Pill
          key={pill.key}
          tone={pill.tone}
          size="sm"
          className={onPaper && pill.tone === 'neutral' ? s.onPaper : undefined}
        >
          {pill.text}
        </Pill>
      ))}
    </span>
  );
}
