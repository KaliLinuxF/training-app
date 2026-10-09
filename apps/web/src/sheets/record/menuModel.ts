/**
 * «Що записати?» — the «+» menu: four rows (Їжа, Тренування, Вага, Заміри) with a light status
 * each, worked out from the stored data of the menu's date (plan D19: own statuses, no dependency
 * on the Home model). Pure: the date and today come in, nothing reads the clock.
 */
import { dLong, DOW_LONG, f0, f1, ok, weekdayOf, type AppData, type DayEntry, type ISODate } from '@legko/shared';
import { kcalGoalView } from '@/features/goal';
import { dueReminders, measuredOn } from '@/lib/stats';
import type { IconName, ListIconTone } from '@/ui';

/** The short sheet each row opens. */
export type CaptureMenuMode = 'food' | 'workout' | 'weight' | 'measure';

/**
 * Right-hand status of a row:
 * - `value` — what is recorded, soft («65,4 кг», «✕ Не було», «Записано» for food without kcal)
 * - `over`  — the day's kcal above the goal (`--accD`)
 * - `done`  — the action is done for the day (`--acc2D`: «✓ Було», «✓ записано»)
 * - `due`   — planned for today and not done yet (a «Сьогодні» / «За планом» pill)
 */
export type CaptureStatusKind = 'value' | 'done' | 'over' | 'due';

export interface CaptureMenuStatus {
  kind: CaptureStatusKind;
  text: string;
}

export interface CaptureMenuRow {
  mode: CaptureMenuMode;
  title: string;
  sub: string;
  icon: IconName;
  iconTone: ListIconTone;
  status: CaptureMenuStatus | null;
}

/** Title and second line of each row. */
export const MENU_ROW_COPY: Readonly<Record<CaptureMenuMode, { title: string; sub: string }>> = {
  food: { title: 'Їжа', sub: 'Опис або фото' },
  workout: { title: 'Тренування', sub: 'Було чи ні, тип' },
  weight: { title: 'Вага', sub: 'Контрольне зважування' },
  measure: { title: 'Заміри', sub: 'Груди, талія, стегна' },
};

/** Status texts. The due pills are capitalised, like Home's «Сьогодні» pill. */
export const MENU_STATUS = {
  trained: '✓ Було',
  notTrained: '✕ Не було',
  planned: 'За планом',
  dueToday: 'Сьогодні',
  measured: '✓ записано',
  /** Food described or photographed, no kcal: the same word as Home's Їжа row. */
  foodRecorded: 'Записано',
} as const;

/** The ghost button under the rows: opens the full «Запис дня» for the menu's date. */
export const FULL_DAY_LABEL = 'Повний запис дня';

const kcalText = (kcal: number): string => `${f0(kcal)} ккал`;
const kgText = (kg: number): string => `${f1(kg)} кг`;

/** A meal is recorded: a description or a photo (like Home and the calendar). */
const hasFood = (e: DayEntry | undefined): boolean =>
  !!e && (e.food.trim() !== '' || (e.photos?.length ?? 0) > 0);

/**
 * The menu rows for `date`, in order: Їжа, Тренування, Вага, Заміри. Due pills only for today,
 * and only after the first-run setup (like Home).
 */
export function captureMenuRows(data: AppData, date: ISODate, today: ISODate): CaptureMenuRow[] {
  const entry = data.days[date];
  const due = date === today && data.settings.onboarded ? dueReminders(data, today) : [];

  // The kcal number wins; a meal without kcal still reads as recorded.
  const kcal = entry?.kcal;
  const food: CaptureMenuStatus | null =
    ok(kcal) && kcal > 0
      ? {
          kind: kcalGoalView(kcal, data.settings.kcalGoal).state === 'over' ? 'over' : 'value',
          text: kcalText(kcal),
        }
      : hasFood(entry)
        ? { kind: 'value', text: MENU_STATUS.foodRecorded }
        : null;

  const trained = entry?.trained ?? null;
  const workout: CaptureMenuStatus | null =
    trained === true
      ? { kind: 'done', text: MENU_STATUS.trained }
      : trained === false
        ? { kind: 'value', text: MENU_STATUS.notTrained }
        : due.includes('workout')
          ? { kind: 'due', text: MENU_STATUS.planned }
          : null;

  const weighIn = data.weights.find((w) => w.date === date && ok(w.kg));
  const weight: CaptureMenuStatus | null = weighIn
    ? { kind: 'value', text: kgText(weighIn.kg) }
    : due.includes('weigh')
      ? { kind: 'due', text: MENU_STATUS.dueToday }
      : null;

  const measure: CaptureMenuStatus | null = measuredOn(data, date)
    ? { kind: 'done', text: MENU_STATUS.measured }
    : due.includes('measure')
      ? { kind: 'due', text: MENU_STATUS.dueToday }
      : null;

  return [
    { mode: 'food', ...MENU_ROW_COPY.food, icon: 'food', iconTone: 'acc2', status: food },
    { mode: 'workout', ...MENU_ROW_COPY.workout, icon: 'workout', iconTone: 'acc', status: workout },
    { mode: 'weight', ...MENU_ROW_COPY.weight, icon: 'weight', iconTone: 'neutral', status: weight },
    { mode: 'measure', ...MENU_ROW_COPY.measure, icon: 'measure', iconTone: 'neutral', status: measure },
  ];
}

/** «13 жовтня · вівторок» above the rows when the menu is for another day than today; `null` for today. */
export function captureMenuDateLine(date: ISODate, today: ISODate): string | null {
  return date === today ? null : `${dLong(date)} · ${DOW_LONG[weekdayOf(date)]}`;
}
