import { useId } from 'react';
import { Card, CardHeader, KeyValueRow } from '@/ui';
import type { ValueCell } from './model';
import s from './SummaryCard.module.css';

export interface SummaryCardProps {
  /** Period title: «Цього тижня», «За 3 місяці»… */
  title: string;
  rows: readonly ValueCell[];
}

/** Lavender «Цього тижня» card: trainings, average kcal and body changes for the period. */
export function SummaryCard({ title, rows }: SummaryCardProps) {
  const titleId = useId();
  return (
    <Card as="section" variant="tint" aria-labelledby={titleId}>
      <CardHeader title={title} titleId={titleId} className={s.header} />
      {rows.map((row) => (
        <KeyValueRow key={row.label} variant="summary" label={row.label} value={row.value} tone={row.tone} />
      ))}
    </Card>
  );
}
