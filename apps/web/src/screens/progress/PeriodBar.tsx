import { PERIODS, type Period } from '@/lib/stats';
import { Segmented, type SegmentedOption } from '@/ui';
import s from './PeriodBar.module.css';

export const PERIOD_OPTIONS: readonly SegmentedOption<Period>[] = PERIODS.map(({ id, label }) => ({
  value: id,
  label,
}));

export interface PeriodBarProps {
  value: Period;
  onChange: (period: Period) => void;
}

/**
 * «Тиждень · Місяць · 3 міс. · Весь час», sticky under the safe area on a `--paper` backdrop (with a short fade
 * below), so no card edge shows above or through it while the cards scroll underneath.
 */
export function PeriodBar({ value, onChange }: PeriodBarProps) {
  return (
    <div className={s.bar}>
      <Segmented full aria-label="Період" options={PERIOD_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}
