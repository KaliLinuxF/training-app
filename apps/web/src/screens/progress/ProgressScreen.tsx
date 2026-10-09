import type { AppData, ISODate } from '@legko/shared';
import { useLocation } from 'wouter';
import { PERIODS, type Period } from '@/lib/stats';
import { useToday } from '@/lib/useToday';
import { useAppData } from '@/store/data';
import { ContentGrid, ScreenHeader, Segmented, type SegmentedOption } from '@/ui';
import { MeasuresCard } from './MeasuresCard';
import { NutritionCard } from './NutritionCard';
import { SummaryCard } from './SummaryCard';
import { useProgressModel } from './useProgressModel';
import { WeightCard } from './WeightCard';
import { WorkoutsCard } from './WorkoutsCard';

const PERIOD_OPTIONS: readonly SegmentedOption<Period>[] = PERIODS.map(({ id, label }) => ({ value: id, label }));

/** «Мій прогрес» — automatic statistics from the daily records (route `/progress`). */
export function ProgressScreen() {
  const data = useAppData();
  const today = useToday();
  return <ProgressView data={data} today={today} />;
}

export interface ProgressViewProps {
  data: AppData;
  today: ISODate;
}

/** The screen for given data and date (separate from the store hooks for tests). */
export function ProgressView({ data, today }: ProgressViewProps) {
  const { model, period, setPeriod, setMeasure, showMoreHistory } = useProgressModel(data, today);
  const [, navigate] = useLocation();
  return (
    <ContentGrid>
      <ScreenHeader subtitle="Автоматична статистика" title="Мій прогрес" />
      <Segmented full sticky aria-label="Період" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      <SummaryCard title={model.period.title} rows={model.summary} />
      <WeightCard tiles={model.weight.tiles} chart={model.weight.chart} />
      <MeasuresCard
        rows={model.measures.rows}
        chart={model.measures.chart}
        chartLabel={model.measures.chartLabel}
        onSelect={setMeasure}
      />
      <WorkoutsCard
        tiles={model.workouts.tiles}
        typesHeading={model.workouts.typesHeading}
        types={model.workouts.types}
      />
      <NutritionCard {...model.nutrition} onShowMore={showMoreHistory} onOpenDay={(href) => navigate(href)} />
    </ContentGrid>
  );
}
