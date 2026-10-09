import { useId } from 'react';
import { Button, Card, CardHeader, Tile, TrainingToggle } from '@/ui';
import type { HomeToday } from './homeModel';
import s from './TodayCard.module.css';

export interface TodayCardProps {
  today: HomeToday;
  /** Opens today's day sheet. */
  onOpen: () => void;
  /** «✓ Було» (`true`) / «✕ Не було» (`false`). */
  onTrained: (trained: boolean) => void;
}

/** «Сьогодні»: food / kcal tiles and the workout yes/no pair (Tracker.dc.html lines 72–89). */
export function TodayCard({ today, onOpen, onTrained }: TodayCardProps) {
  const titleId = useId();
  const trainingId = useId();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader
        title="Сьогодні"
        titleId={titleId}
        right={
          <Button variant="ghost" className={s.openDay} onClick={onOpen} aria-label="Відкрити день">
            Відкрити день →
          </Button>
        }
      />
      <div className={s.tiles}>
        <Tile variant="entry" label="Харчування" value={today.food} onClick={onOpen} />
        <Tile variant="entry" label="Калорії" value={today.kcal} onClick={onOpen} />
      </div>
      <div className={s.training}>
        <p id={trainingId} className={s.trainingLabel}>
          Тренування · <span className={s.trainingState}>{today.training}</span>
        </p>
        <TrainingToggle value={today.trained} onChange={onTrained} aria-labelledby={trainingId} />
      </div>
    </Card>
  );
}
