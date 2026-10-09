import { useId } from 'react';
import { BarRow, Card, CardHeader, StatStrip, type StatItem } from '@/ui';
import type { TypeBarModel } from './model';
import s from './WorkoutsCard.module.css';

export interface WorkoutsCardProps {
  /** Всього · Цього тижня · Цього місяця · В сер. / тиж. */
  stats: readonly StatItem[];
  /** «Найчастіше · цього тижня» */
  typesHeading: string;
  /** Top types of the period (at most `TYPES_SHOWN`). */
  types: readonly TypeBarModel[];
}

export const NO_WORKOUTS = 'За цей період тренувань ще немає';

/** «Тренування»: four counters in a strip and the most frequent workout types of the period. */
export function WorkoutsCard({ stats, typesHeading, types }: WorkoutsCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Тренування" titleId={titleId} />
      <StatStrip items={stats} columns={4} />
      <div className={s.types}>
        <h3 className={s.heading}>{typesHeading}</h3>
        {types.length > 0 ? (
          types.map((type) => (
            <BarRow key={type.label} variant="rank" label={type.label} value={type.value} pct={type.pct} />
          ))
        ) : (
          <p className={s.empty}>{NO_WORKOUTS}</p>
        )}
      </div>
    </Card>
  );
}
