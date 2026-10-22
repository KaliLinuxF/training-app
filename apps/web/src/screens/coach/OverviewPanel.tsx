import type { AppData, CoachSummary, ISODate, MeasureKey } from '@legko/shared';
import { useId, useMemo, useState } from 'react';
import { Card, CardHeader, ContentGrid, ListGroup, ListRow, StatStrip } from '@/ui';
import { MeasuresCard } from '../progress/MeasuresCard';
import { buildProgressModel } from '../progress/model';
import { WeightCard } from '../progress/WeightCard';
import { checkRows, kpiItems } from './clientModel';
import { COACH_COPY, TAB_LABELS } from './copy';
import s from './OverviewPanel.module.css';

export interface OverviewPanelProps {
  data: AppData;
  /** The client's today. */
  today: ISODate;
  summary: CoachSummary;
  now: Date;
}

/**
 * «Огляд» (docs/coach-cabinet.md §6.3): the numbers of the period («Зараз») and what to check (the flags with their
 * details), each across the width, then the client's own «Вага» and «Заміри тіла» side by side on the desktop
 * (3 months, coach hints, no «+ Записати …»). A client without any record gets one calm card instead: the flags are
 * in the header already, and empty weight / measures cards would only repeat «nothing yet».
 */
export function OverviewPanel({ data, today, summary, now }: OverviewPanelProps) {
  const [measure, setMeasure] = useState<MeasureKey>('waist');
  const model = useMemo(
    () => buildProgressModel(data, today, { period: 'q', measure, historyLimit: 0, audience: 'coach' }),
    [data, today, measure],
  );
  const nowId = useId();
  const newId = useId();

  if (!summary.hasRecords) {
    return (
      <ContentGrid>
        <h2 className="visually-hidden">{TAB_LABELS.overview}</h2>
        <Card as="section" full aria-labelledby={newId} gap={6}>
          <CardHeader title={COACH_COPY.newClientTitle} titleId={newId} />
          <p className={s.text}>{COACH_COPY.newClientText}</p>
        </Card>
      </ContentGrid>
    );
  }

  const rows = checkRows(summary, now);
  return (
    <ContentGrid>
      <h2 className="visually-hidden">{TAB_LABELS.overview}</h2>
      <Card as="section" full aria-labelledby={nowId}>
        <CardHeader title={COACH_COPY.now} titleId={nowId} />
        <StatStrip items={kpiItems(summary)} columns={2} desktopColumns={3} />
      </Card>
      <ListGroup title={COACH_COPY.checkTitle} full>
        {rows.map((row) => (
          <ListRow key={row.key} title={row.title} sub={row.sub} subWrap />
        ))}
      </ListGroup>
      <WeightCard weight={model.weight} />
      <MeasuresCard
        rows={model.measures.rows}
        chart={model.measures.chart}
        chartLabel={model.measures.chartLabel}
        onSelect={setMeasure}
      />
    </ContentGrid>
  );
}
