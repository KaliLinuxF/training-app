import { cx, ProgressBar } from '@/ui';
import type { KcalGoalView } from './kcalGoal';
import s from './KcalGoalLine.module.css';

export interface KcalGoalLineProps {
  view: KcalGoalView;
  id?: string;
  className?: string;
}

/**
 * Daily calorie goal under a kcal value: a thin bar (mint within the goal, lavender over it) and one line —
 * «Залишилось 650 з 1 700 ккал», or a warning pill «Перевищено на 120 ккал · ціль 1 700».
 */
export function KcalGoalLine({ view, id, className }: KcalGoalLineProps) {
  const over = view.state === 'over';
  return (
    <div id={id} className={cx(s.root, className)}>
      <ProgressBar value={view.pct} size="sm" tone={over ? 'acc' : 'acc2'} label={view.label} />
      {over ? (
        <p className={s.warning}>
          <svg className={s.icon} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
          </svg>
          {view.text}
        </p>
      ) : (
        <p className={cx(s.text, view.state === 'reached' && s.reached)}>{view.text}</p>
      )}
    </div>
  );
}
