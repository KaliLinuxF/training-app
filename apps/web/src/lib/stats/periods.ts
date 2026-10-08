import { addDays, mondayOf, type AppData, type ISODate } from '@legko/shared';
import { byDateAsc, sortedDayKeys } from './common';

/** Summary period of the «Мій прогрес» screen. */
export type Period = 'week' | 'month' | 'q' | 'all';

export interface PeriodMeta {
  id: Period;
  /** Segmented-control label: «Тиждень». */
  label: string;
  /** Summary heading: «Цього тижня». */
  title: string;
  /** Lower-case title for inline use: «Найчастіше · цього тижня». */
  short: string;
}

/** Periods in the order of the segmented control. */
export const PERIODS: readonly PeriodMeta[] = [
  { id: 'week', label: 'Тиждень', title: 'Цього тижня', short: 'цього тижня' },
  { id: 'month', label: 'Місяць', title: 'За останні 30 днів', short: 'за останні 30 днів' },
  { id: 'q', label: '3 міс.', title: 'За 3 місяці', short: 'за 3 місяці' },
  { id: 'all', label: 'Весь час', title: 'За весь період', short: 'за весь період' },
];

/** Type guard for values coming from the URL or storage. */
export const isPeriod = (v: unknown): v is Period => PERIODS.some((p) => p.id === v);

/** Metadata of one period. */
export function periodMeta(period: Period): PeriodMeta {
  const meta = PERIODS.find((p) => p.id === period);
  if (!meta) throw new RangeError(`Unknown period: ${String(period)}`);
  return meta;
}

/**
 * The earliest date anything was recorded (day entry, weigh-in or measurement),
 * never later than `today` — the start of the «Весь час» period.
 */
export function earliestDate(data: AppData, today: ISODate): ISODate {
  const candidates = [
    sortedDayKeys(data)[0],
    byDateAsc(data.weights)[0]?.date,
    byDateAsc(data.measures)[0]?.date,
    today,
  ];
  return candidates.reduce<ISODate>((min, d) => (d !== undefined && d < min ? d : min), today);
}

/**
 * First day (inclusive) of a period ending today:
 * week → Monday of this week; month → today − 29; q → today − 89; all → `earliestDate`.
 */
export function periodStart(data: AppData, period: Period, today: ISODate): ISODate {
  switch (period) {
    case 'week':
      return mondayOf(today);
    case 'month':
      return addDays(today, -29);
    case 'q':
      return addDays(today, -89);
    case 'all':
      return earliestDate(data, today);
  }
}
