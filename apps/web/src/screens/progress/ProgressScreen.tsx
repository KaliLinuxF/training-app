import type { AppData, ISODate } from '@legko/shared';
import { useLocation } from 'wouter';
import type { Period } from '@/lib/stats';
import { useToday } from '@/lib/useToday';
import { exercisePath } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { ContentGrid, cx, ScreenHeader } from '@/ui';
import { MeasuresCard } from './MeasuresCard';
import type { ProgressAudience } from './model';
import { NutritionCard } from './NutritionCard';
import { PeriodBar } from './PeriodBar';
import { usePeriod } from './period';
import s from './ProgressScreen.module.css';
import { StepsCard } from './StepsCard';
import { SummaryCard } from './SummaryCard';
import { useProgressModel } from './useProgressModel';
import { WeightCard } from './WeightCard';
import { WorkoutsCard } from './WorkoutsCard';

/** «Мій прогрес» — automatic statistics from the daily records (route `/progress[?period=…]`). */
export function ProgressScreen() {
  const data = useAppData();
  const today = useToday();
  return <ProgressView data={data} today={today} onRecord={(mode) => ui.openSheet(today, mode)} />;
}

export interface ProgressViewProps {
  data: AppData;
  today: ISODate;
  /** «+ Записати вагу» / «+ Записати заміри» in the empty charts: opens that sheet for today. */
  onRecord?: (mode: 'weight' | 'measure') => void;
}

/**
 * The screen for given data and date (separate from the store hooks for tests), with her session-remembered period
 * (`usePeriod`: `?period=` links, sessionStorage). Phone: one column. Desktop: header, period bar and summary
 * across, then Вага | Заміри тіла, Тренування | Кроки (once she logged steps) and Харчування.
 */
export function ProgressView(props: ProgressViewProps) {
  const [period, setPeriod] = usePeriod();
  return <ProgressBody {...props} period={period} onPeriodChange={setPeriod} />;
}

export interface ProgressBodyProps extends ProgressViewProps {
  /** The selected period: owned by the caller (nothing is stored or put in the URL here). */
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** <h1> title; null = no ScreenHeader (the coach page has its own). Default «Мій прогрес». */
  title?: string | null;
  /** 'coach': third-person empty-chart hints and never a «+ Записати …» button (onRecord ignored). Default 'self'. */
  audience?: ProgressAudience;
  /** Where an «Історія калорій» row leads. Default `calendarDayHref` = `/calendar?date=${date}`. Keep it stable. */
  dayHref?: (date: ISODate) => string;
  /** Called with that href on a row click. Default `navigate(href)` (push, exactly her screen's behaviour). */
  onOpenDay?: (href: string) => void;
  /**
   * Where a «Найчастіші вправи» row leads. Default `exercisePath` (her exercise detail); null = no links. The coach
   * audience never links, whatever is passed.
   */
  exerciseHref?: ((id: string) => string) | null;
  /** Merged into the root ContentGrid's class. */
  className?: string;
}

/** The progress cards for given data, date and a controlled period. */
export function ProgressBody({
  data,
  today,
  onRecord,
  period,
  onPeriodChange,
  title = 'Мій прогрес',
  audience = 'self',
  dayHref,
  onOpenDay,
  exerciseHref = exercisePath,
  className,
}: ProgressBodyProps) {
  const { model, setMeasure, showMoreHistory } = useProgressModel(data, today, period, { audience, dayHref });
  const [, navigate] = useLocation();
  // The coach only reads: no way to record anything for the client, whatever the caller passes.
  const record = audience === 'coach' ? undefined : onRecord;
  // Nor into her exercise pages (they are her own screens, not the coach's).
  const exerciseLink = audience === 'coach' ? null : exerciseHref;
  return (
    <ContentGrid className={cx(s.screen, className)}>
      {title !== null && <ScreenHeader title={title} className={s.header} />}
      <PeriodBar value={period} onChange={onPeriodChange} />
      <SummaryCard title={model.summary.title} items={model.summary.items} />
      <WeightCard weight={model.weight} onRecord={record && (() => record('weight'))} />
      <MeasuresCard
        rows={model.measures.rows}
        chart={model.measures.chart}
        chartLabel={model.measures.chartLabel}
        onSelect={setMeasure}
        onRecord={record && (() => record('measure'))}
      />
      <WorkoutsCard
        stats={model.workouts.stats}
        typesHeading={model.workouts.typesHeading}
        types={model.workouts.types}
        charts={model.workouts.charts}
        burned={model.workouts.burned}
        exercises={model.workouts.exercises}
        exerciseHref={exerciseLink}
      />
      {model.steps && <StepsCard {...model.steps} />}
      <NutritionCard
        {...model.nutrition}
        onShowMore={showMoreHistory}
        onOpenDay={onOpenDay ?? ((href) => navigate(href))}
      />
    </ContentGrid>
  );
}
