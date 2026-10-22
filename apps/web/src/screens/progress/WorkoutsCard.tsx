import { useId, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { WorkoutChartMetric } from '@/lib/stats';
import {
  backState,
  BarChart,
  BarRow,
  Card,
  CardHeader,
  Icon,
  ProgressBar,
  Segmented,
  StatStrip,
  type StatItem,
} from '@/ui';
import type { ExerciseRankModel, TypeBarModel, WorkoutsModel } from './model';
import s from './WorkoutsCard.module.css';

export interface WorkoutsCardProps {
  /** Всього · Цього тижня · Цього місяця · В сер. / тиж. */
  stats: readonly StatItem[];
  /** «Найчастіше · цього тижня» */
  typesHeading: string;
  /** Top types of the period (at most `TYPES_SHOWN`). */
  types: readonly TypeBarModel[];
  /** «Тренування | Обʼєм» per bucket of the period. */
  charts?: WorkoutsModel['charts'];
  /** «Спалено на тренуваннях ≈ …»; null without sessions in the period. */
  burned?: string | null;
  /** «Найчастіші вправи». */
  exercises?: readonly ExerciseRankModel[];
  /** Where an exercise row leads (its detail); null = static rows (the coach). */
  exerciseHref?: ((id: string) => string) | null;
}

export const NO_WORKOUTS = 'За цей період тренувань ще немає';
export const TOP_EXERCISES = 'Найчастіші вправи';
/** Over an empty chart of the chosen metric (the other one has data). */
export const NO_DATA_FOR_METRIC = 'За цей період даних ще немає';

const METRICS = [
  { value: 'trainings', label: 'Тренування' },
  { value: 'volume', label: 'Обʼєм' },
] as const satisfies readonly { value: WorkoutChartMetric; label: string }[];

/**
 * «Тренування»: four counters, the «Тренування | Обʼєм» chart of the period (neutral bars, no goal), the burned kcal
 * of the period's sessions, the most frequent exercises (linked to their detail) and the most frequent types.
 */
export function WorkoutsCard({
  stats,
  typesHeading,
  types,
  charts,
  burned = null,
  exercises = [],
  exerciseHref = null,
}: WorkoutsCardProps) {
  const titleId = useId();
  const [picked, setMetric] = useState<WorkoutChartMetric>('trainings');
  // Calm by default: no chart for a period without any training, and «Обʼєм» only once a session has volume.
  const withVolume = charts?.volume.hasData ?? false;
  const metric: WorkoutChartMetric = withVolume ? picked : 'trainings';
  const chart = charts && (charts.trainings.hasData || withVolume) ? charts[metric] : undefined;
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Тренування" titleId={titleId} />
      <StatStrip items={stats} columns={4} />
      {chart && (
        <div className={s.chartBlock}>
          {withVolume && (
            <Segmented
              options={METRICS}
              value={metric}
              onChange={setMetric}
              aria-label="Що показує графік тренувань"
            />
          )}
          <div className={s.chart}>
            <BarChart bars={chart.bars} gap={chart.gap} labeled={chart.labeled} aria-label={chart.label} />
            {!chart.hasData && <p className={s.chartEmpty}>{NO_DATA_FOR_METRIC}</p>}
          </div>
        </div>
      )}
      {burned && <p className={s.burned}>{burned}</p>}
      {exercises.length > 0 && (
        <div className={s.types}>
          <h3 className={s.heading}>{TOP_EXERCISES}</h3>
          {exercises.map((ex) => (
            <ExerciseRow key={ex.exerciseId} ex={ex} href={exerciseHref ? exerciseHref(ex.exerciseId) : null} />
          ))}
        </div>
      )}
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

/** One exercise: its name (cut with «…»), a bar and the count; a link to its detail unless `href` is null. */
function ExerciseRow({ ex, href }: { ex: ExerciseRankModel; href: string | null }) {
  const [location] = useLocation();
  const content = (
    <>
      <span className={s.exName}>{ex.label}</span>{' '}
      <ProgressBar value={ex.pct} size="lg" tone="acc2" />{' '}
      <span className={s.exValue}>{ex.value}</span>
    </>
  );
  if (href === null) {
    return (
      <div className={s.exercise} role="group" aria-label={ex.ariaLabel}>
        {content}
      </div>
    );
  }
  return (
    <Link
      href={href}
      state={backState(location)}
      className={`${s.exercise} ${s.exerciseLink}`}
      aria-label={`${ex.ariaLabel}. Відкрити вправу`}
    >
      {content}
      <Icon name="chevronRight" size={16} className={s.exChevron} />
    </Link>
  );
}
