import { useId } from 'react';
import { PhotoStrip } from '@/features/food';
import { Button, Card, CardHeader, DetailRow, Pill } from '@/ui';
import type { DayDetail, DetailRowModel } from './model';
import s from './DayCard.module.css';

export interface DayCardProps {
  detail: DayDetail;
  onEdit: () => void;
}

/** Selected day details (prototype lines 174–189). */
export function DayCard({ detail, onEdit }: DayCardProps) {
  const titleId = useId();
  return (
    <Card as="section" gap={6} aria-labelledby={titleId}>
      <CardHeader
        size="lg"
        align="start"
        className={s.header}
        titleId={titleId}
        title={detail.title}
        subtitle={detail.weekday}
        right={<Pill tone={detail.statusTone}>{detail.statusLabel}</Pill>}
      />
      {detail.rows.map((row) => (
        <DetailRow
          key={row.key}
          label={row.label}
          value={row.key === 'food' && detail.photos.length ? <FoodValue row={row} photos={detail.photos} /> : row.value}
        />
      ))}
      <Button className={s.action} onClick={onEdit}>
        {detail.actionLabel}
      </Button>
    </Card>
  );
}

/** «Харчування» text with the day's photo thumbnails underneath. */
function FoodValue({ row, photos }: { row: DetailRowModel; photos: string[] }) {
  return (
    <>
      {row.value !== '—' && <span className={s.foodText}>{row.value}</span>}
      <span className={s.photos}>
        <PhotoStrip ids={photos} size="sm" />
      </span>
    </>
  );
}
