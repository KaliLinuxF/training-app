/**
 * The coach's read-only day (docs/coach-cabinet.md §6.5), pure. It reuses the client's own models — `buildDayDetail`
 * (title, status and the Тренування / Вага / Заміри / Нотатки rows) and `foodDayModel` (meal rows and the day's
 * totals) — but takes **only** `title`, `value`, `valueTone` and `text` from the day rows: never `label` («Вага:
 * додати»), `action`, `mode` or `trained`, which belong to the client's editing UI.
 */
import type { AppData, ISODate } from '@legko/shared';
import { foodDayModel, type FoodDayRow, type FoodDayTotals } from '@/sheets/record/foodDayModel';
import { buildDayDetail, type StatusTone } from '../calendar/model';

export interface CoachDayRow {
  key: string;
  title: string;
  /** «65,4 кг»; null = nothing recorded (shown as a faint «—» when there is no text either). */
  value: string | null;
  valueTone: 'ink' | 'acc';
  /** Workout types / «Було» / «Не було» / «Ще не відмічено», the measurements, the notes. */
  text: string | null;
}

export interface CoachDayModel {
  date: ISODate;
  /** «13 жовтня 2026». */
  title: string;
  /** «вівторок». */
  weekday: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** Nothing at all that day (no day record, no weigh-in, no measurement). */
  empty: boolean;
  /** One row per meal (a day logged before meals = one block). */
  meals: FoodDayRow[];
  /** The day's kcal and Б · Ж · В against the client's goals; null without food. */
  totals: FoodDayTotals | null;
  /** Тренування, Вага, Заміри, and Нотатки when there are notes. */
  rows: CoachDayRow[];
}

export function coachDayModel(data: AppData, date: ISODate, today: ISODate): CoachDayModel {
  const detail = buildDayDetail(data, date, today);
  const food = foodDayModel(data, date);
  const empty =
    data.days[date] === undefined &&
    !data.weights.some((w) => w.date === date) &&
    !data.measures.some((m) => m.date === date);
  const rows = detail.rows
    .filter((row) => row.key !== 'food')
    .map(
      (row): CoachDayRow => ({
        key: row.key,
        title: row.title,
        value: row.value ?? null,
        valueTone: row.valueTone,
        text: row.text ?? null,
      }),
    );
  return {
    date,
    title: detail.title,
    weekday: detail.weekday,
    statusLabel: detail.statusLabel,
    statusTone: detail.statusTone,
    empty,
    meals: food.rows,
    totals: food.rows.length > 0 ? food.totals : null,
    rows,
  };
}
