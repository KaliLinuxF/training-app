import type { AppData, ISODate } from '@legko/shared';
import { useLocation } from 'wouter';
import { useToday } from '@/lib/useToday';
import { useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { ContentGrid, ScreenHeader } from '@/ui';
import { MeasuresCard } from './MeasuresCard';
import { NutritionCard } from './NutritionCard';
import { PeriodBar } from './PeriodBar';
import s from './ProgressScreen.module.css';
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
 * The screen for given data and date (separate from the store hooks for tests). Phone: one column. Desktop:
 * header, period bar and summary across, then Вага | Заміри тіла and Тренування | Харчування.
 */
export function ProgressView({ data, today, onRecord }: ProgressViewProps) {
  const { model, period, setPeriod, setMeasure, showMoreHistory } = useProgressModel(data, today);
  const [, navigate] = useLocation();
  return (
    <ContentGrid className={s.screen}>
      <ScreenHeader title="Мій прогрес" className={s.header} />
      <PeriodBar value={period} onChange={setPeriod} />
      <SummaryCard title={model.summary.title} items={model.summary.items} />
      <WeightCard weight={model.weight} onRecord={onRecord && (() => onRecord('weight'))} />
      <MeasuresCard
        rows={model.measures.rows}
        chart={model.measures.chart}
        chartLabel={model.measures.chartLabel}
        onSelect={setMeasure}
        onRecord={onRecord && (() => onRecord('measure'))}
      />
      <WorkoutsCard
        stats={model.workouts.stats}
        typesHeading={model.workouts.typesHeading}
        types={model.workouts.types}
      />
      <NutritionCard {...model.nutrition} onShowMore={showMoreHistory} onOpenDay={(href) => navigate(href)} />
    </ContentGrid>
  );
}
