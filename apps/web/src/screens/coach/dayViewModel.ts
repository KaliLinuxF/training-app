/**
 * The coach's read-only day (docs/coach-cabinet.md §6.5), pure. It reuses the client's own models — `buildDayDetail`
 * (title, status and the Тренування / Кроки / Вага / Заміри / Нотатки rows) and `foodDayModel` (meal rows and the
 * day's totals) — but takes **only** `title`, `value`, `valueTone` and `text` from the day rows: never `label`
 * («Вага: додати»), `action`, `mode`, `trained` or `recorded`, which belong to the client's editing UI. Each done
 * session of the day adds its exercise rows (`coachSessionsOn`, docs/workouts-steps-rebrand.md §3.18).
 */
import type { AppData, ISODate } from '@legko/shared';
import { foodDayModel, type FoodDayRow, type FoodDayTotals } from '@/sheets/record/foodDayModel';
import { buildDayDetail, type StatusTone } from '../calendar/model';
import { coachSessionsOn, type CoachSessionModel } from './workoutsModel';

export interface CoachDayRow {
  key: string;
  title: string;
  /** «65,4 кг»; null = nothing recorded (shown as a faint «—» when there is no text either). */
  value: string | null;
  valueTone: 'ink' | 'acc';
  /**
   * Workout types / «Було» / «Не було» / «Ще не відмічено» (or one line per done session, newline-separated), the
   * steps' goal and kcal, the measurements, the notes.
   */
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
  /** Nothing at all that day (no day record, weigh-in, measurement, steps or session). */
  empty: boolean;
  /** One row per meal (a day logged before meals = one block). */
  meals: FoodDayRow[];
  /** The day's kcal and Б · Ж · В against the client's goals; null without food. */
  totals: FoodDayTotals | null;
  /** Тренування, Кроки, Вага, Заміри, and Нотатки when there are notes. */
  rows: CoachDayRow[];
  /** The day's done sessions with their exercises (static groups under the day). */
  sessions: CoachSessionModel[];
}

export function coachDayModel(data: AppData, date: ISODate, today: ISODate): CoachDayModel {
  const detail = buildDayDetail(data, date, today);
  const food = foodDayModel(data, date);
  const sessions = coachSessionsOn(data, date);
  const empty =
    data.days[date] === undefined &&
    !data.weights.some((w) => w.date === date) &&
    !data.measures.some((m) => m.date === date) &&
    !data.steps.some((x) => x.date === date) &&
    sessions.length === 0;
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
    sessions,
  };
}
