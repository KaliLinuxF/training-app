import { useEffect, useRef } from 'react';
import { cx } from '@/ui';
import { REST_OVER_ANNOUNCEMENT, REST_VIBRATION, restText, restView } from './restModel';
import s from './RestTimer.module.css';

export interface RestTimerProps {
  /** Epoch ms when the rest ends. */
  endsAt: number;
  /** The current time (the session screen's 1 s clock). */
  now: number;
  /** «−15 с» / «+15 с» while counting down. */
  onAdjust: (deltaSec: number) => void;
  /** «Пропустити» (counting) — the rest is dropped. */
  onSkip: () => void;
  /** «Сховати» (over) — the bar goes until the next confirmed set. */
  onHide: () => void;
}

/**
 * The rest bar above the session footer (§3.10): «Відпочинок 1:12» with −15 с / +15 с / Пропустити; at 0 it vibrates
 * (where supported), says «Час! Наступний підхід» once and STAYS, mint, counting up «Відпочинок завершено · +0:23»
 * until the next set or «Сховати». The time is a `role="timer"` without live announcements; text only (no animation).
 */
export function RestTimer({ endsAt, now, onAdjust, onSkip, onHide }: RestTimerProps) {
  const view = restView(endsAt, now);
  const over = view.phase === 'over';

  // Vibrate once when THIS countdown reaches 0 (not when a bar that was already over is shown again after a reload).
  const counted = useRef(false);
  useEffect(() => {
    if (!over) {
      counted.current = true;
      return;
    }
    if (!counted.current) return;
    counted.current = false;
    try {
      navigator.vibrate?.(REST_VIBRATION);
    } catch {
      // not allowed here
    }
  }, [over, endsAt]);

  return (
    <div className={cx(s.bar, over && s.over)} role="group" aria-label="Відпочинок">
      <span className={s.time} role="timer">
        {restText(view)}
      </span>
      <span className={s.actions}>
        {over ? (
          <button type="button" className={s.action} onClick={onHide}>
            Сховати
          </button>
        ) : (
          <>
            <button
              type="button"
              className={s.action}
              onClick={() => onAdjust(-15)}
              aria-label="Відпочинок: мінус 15 секунд"
            >
              −15 с
            </button>
            <button
              type="button"
              className={s.action}
              onClick={() => onAdjust(15)}
              aria-label="Відпочинок: плюс 15 секунд"
            >
              +15 с
            </button>
            <button type="button" className={s.action} onClick={onSkip}>
              Пропустити
            </button>
          </>
        )}
      </span>
      <span className="visually-hidden" aria-live="polite">
        {over ? REST_OVER_ANNOUNCEMENT : ''}
      </span>
    </div>
  );
}
