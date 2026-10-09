import { Button } from '@/ui';
import s from './ChartPlaceholder.module.css';

export interface ChartPlaceholderProps {
  /** What to record to get a chart. */
  hint: string;
  /** Shortcut to the sheet that records it («+ Записати вагу»). */
  action?: { label: string; onClick: () => void };
}

export const NOT_ENOUGH_DATA = 'Ще недостатньо даних';
export const RECORD_WEIGHT = '+ Записати вагу';
export const RECORD_MEASURE = '+ Записати заміри';

/** Friendly empty state of a 120px line chart (fewer than two points), with an optional «+ Записати …». */
export function ChartPlaceholder({ hint, action }: ChartPlaceholderProps) {
  return (
    <div className={s.box}>
      <span className={s.title}>{NOT_ENOUGH_DATA}</span>
      <span className={s.hint}>{hint}</span>
      {action && (
        <Button variant="outline" size="sm" className={s.action} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
