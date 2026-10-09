import { Button } from '@/ui';
import s from './DismissibleBanner.module.css';

export interface DismissibleBannerProps {
  title: string;
  sub?: string;
  cta: string;
  onAction: () => void;
  onDismiss: () => void;
  /** Accessible name of the ✕ button. */
  dismissLabel?: string;
}

/**
 * The kit `Banner` (lavender tint, accent dot, solid CTA) plus a small ✕ that hides it —
 * used for the iPhone install hint. Styles mirror `ui/feedback/Banner.module.css`.
 */
export function DismissibleBanner({
  title,
  sub,
  cta,
  onAction,
  onDismiss,
  dismissLabel = 'Сховати',
}: DismissibleBannerProps) {
  return (
    <div className={s.banner}>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.text}>
        <span className={s.title}>{title}</span>
        {sub != null && <span className={s.sub}>{sub}</span>}
      </div>
      <Button size="sm" onClick={onAction}>
        {cta}
      </Button>
      <button type="button" className={s.close} aria-label={dismissLabel} onClick={onDismiss}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
