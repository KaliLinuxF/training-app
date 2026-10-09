import { cx } from '@/ui';
import type { SyncTone } from './model';
import s from './SyncDot.module.css';

/** 8px status dot in front of a sync line (decorative: the text says the same). */
export function SyncDot({ tone }: { tone: SyncTone }) {
  return <span className={cx(s.dot, s[tone])} aria-hidden="true" />;
}
