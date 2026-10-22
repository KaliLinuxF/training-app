import type { AppData, ISODate } from '@legko/shared';
import { useMemo } from 'react';
import { ContentGrid } from '@/ui';
import { buildMonth, resolveSelected, stepMonth } from '../calendar/model';
import { MonthCard } from '../calendar/MonthCard';
import { useShownMonth } from '../calendar/useShownMonth';
import { detailHref, type DetailParams } from './clientModel';
import { CoachDayView } from './CoachDayView';
import { TAB_LABELS } from './copy';
import { useReplaceParams } from './nav';

export interface CalendarPanelProps {
  clientId: string;
  data: AppData;
  /** The client's today. */
  today: ISODate;
  params: DetailParams;
}

/**
 * «Календар» (docs/coach-cabinet.md §6.5): the client's own month card (fills, swipe, ‹ ›) and the read-only day.
 * A day tap sets `?date=` (replaced, back stamp kept); a future or invalid date falls back to the client's today.
 */
export function CalendarPanel({ clientId, data, today, params }: CalendarPanelProps) {
  const replace = useReplaceParams();
  const selected = resolveSelected(params.date, today);
  const [shown, setShown] = useShownMonth(selected);
  const month = useMemo(() => buildMonth(data, shown, selected, today), [data, shown, selected, today]);

  return (
    <ContentGrid>
      <h2 className="visually-hidden">{TAB_LABELS.calendar}</h2>
      <MonthCard
        month={month}
        onSelect={(date) => replace(detailHref(clientId, { ...params, tab: 'calendar', date }))}
        onStep={(delta) => {
          const next = stepMonth(shown, delta, today);
          if (next) setShown(next);
        }}
      />
      <CoachDayView data={data} date={selected} today={today} />
    </ContentGrid>
  );
}
