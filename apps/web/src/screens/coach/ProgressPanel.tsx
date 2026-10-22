import type { AppData, ISODate } from '@legko/shared';
import { useCallback } from 'react';
import type { Period } from '@/lib/stats';
import { ProgressBody } from '../progress/ProgressScreen';
import { calendarHref, detailHref, type DetailParams } from './clientModel';
import { TAB_LABELS } from './copy';
import { useReplaceParams } from './nav';
import s from './ProgressPanel.module.css';

export interface ProgressPanelProps {
  clientId: string;
  data: AppData;
  /** The client's today. */
  today: ISODate;
  params: DetailParams;
}

/**
 * «Прогрес»: the client's own «Мій прогрес» (`ProgressBody`) — its own grid, never nested in another — without the
 * title and without any «+ Записати …», with the period in `?period=` and the «Історія калорій» rows opening this
 * client's «Календар» on that day; the «Найчастіші вправи» rows stay static (no links into her exercise pages). Every change replaces the entry and keeps its back stamp.
 */
export function ProgressPanel({ clientId, data, today, params }: ProgressPanelProps) {
  const replace = useReplaceParams();
  const dayHref = useCallback((date: ISODate) => calendarHref(clientId, params, date), [clientId, params]);
  const onPeriodChange = (period: Period) => replace(detailHref(clientId, { ...params, period }));
  return (
    <>
      <h2 className="visually-hidden">{TAB_LABELS.progress}</h2>
      <ProgressBody
        data={data}
        today={today}
        period={params.period}
        onPeriodChange={onPeriodChange}
        title={null}
        audience="coach"
        dayHref={dayHref}
        onOpenDay={replace}
        exerciseHref={null}
        className={s.panel}
      />
    </>
  );
}
