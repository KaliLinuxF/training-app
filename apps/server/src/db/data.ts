import {
  foodKey,
  isDayOp,
  isEmptyDay,
  isEmptyMeasure,
  MACRO_KEYS,
  mealSchema,
  mergeSettingsPut,
  normalizeDay,
  normalizeSettings,
  reduceDay,
  settingsSchema,
  useFood,
  type AppData,
  type DayEntry,
  type DayOp,
  type FoodItem,
  type ISODate,
  type Meal,
  type MeasureEntry,
  type MeasureValues,
  type Op,
  type ReminderKind,
  type Settings,
  type WeightEntry,
} from '@legko/shared';
import { z } from 'zod';
import { silentLogger, type Logger } from '../logger';
import { canonicalTimeZone } from '../timezone';
import { num, numOrNull, text, textOrNull } from './rows';
import type { Database, Row } from './sqlite';
import { transaction } from './tx';
import type { UserId } from './users';

/**
 * Persistence of one user's `AppData`. Writes follow `applyOp()` from `@legko/shared` exactly: every day op is
 * `reduceDay(readDay(date), op)` (the same pure reducer the client runs), an empty day or an empty
 * measurement is a delete, puts are upserts keyed by date, `settings.put` goes through `mergeSettingsPut()`
 * and «Часті страви» through `useFood()` / `foodKey()`.
 *
 * A day with meals keeps its derived food / kcal / photos in the usual columns (old builds, the photo GC,
 * reminders read them) and the meals as JSON in `days.meals` (NULL = a legacy day).
 *
 * Every statement is scoped by `user_id = ?` with the repo's own id bound inside (docs/multi-user.md §4): a
 * `DataRepo` can only ever see and change its user's rows.
 */
export interface DataRepo {
  read(): AppData;
  /** Stored settings filled in with defaults (`normalizeSettings`), defaults when never saved. */
  settings(): Settings;
  /** Applies already-validated ops in order, in one transaction. */
  apply(ops: readonly Op[]): void;
  /** Replaces this user's data (import) in one transaction; nobody else's rows are touched. */
  replaceAll(data: AppData): void;
  /**
   * Stores the canonical form of `timeZone` as `settings.timezone`, unless the stored zone is
   * already the same zone under any spelling (`Europe/Kiev` = `Europe/Kyiv`). Returns the stored
   * id, or null when nothing was written.
   */
  setTimezone(timeZone: string): string | null;
  /** Whether the action a reminder asks for was already recorded for `date`. */
  isDone(kind: ReminderKind, date: ISODate): boolean;
}

/** The only way to a `DataRepo`: `forUser(currentUser(c).id)`. */
export interface DataRepos {
  forUser(id: UserId): DataRepo;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const trainedToSql = (t: boolean | null): number | null => (t === null ? null : t ? 1 : 0);
const trainedFromSql = (v: number | null): boolean | null => (v === null ? null : v === 1);

function parseStringArray(row: Row, column: string): string[] {
  const parsed: unknown = JSON.parse(text(row, column));
  if (!Array.isArray(parsed)) throw new TypeError(`days.${column}: expected a JSON array`);
  return parsed.filter((t): t is string => typeof t === 'string');
}

const storedMealsSchema = z.array(mealSchema);

/** `days.meals` → the meals, `[]` for a legacy day (NULL), or null when the JSON is unusable. */
function parseMeals(raw: string | null): Meal[] | null {
  if (raw === null) return [];
  try {
    const parsed = storedMealsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function dayFromRow(row: Row, logger: Logger): DayEntry {
  const day: DayEntry = {
    food: text(row, 'food'),
    kcal: numOrNull(row, 'kcal'),
    trained: trainedFromSql(numOrNull(row, 'trained')),
    types: parseStringArray(row, 'types'),
    notes: text(row, 'notes'),
  };
  // Same shape as normalizeDay(): `photos` only when there are some, `meals` only when non-empty.
  const photos = parseStringArray(row, 'photos');
  if (photos.length) day.photos = photos;
  const meals = parseMeals(textOrNull(row, 'meals'));
  if (meals === null) {
    // The derived columns still hold the food text, kcal and photos: serve it as a legacy day (the next
    // meal op converts it again). Never log the content.
    logger.warn(
      `days.meals of ${text(row, 'date')} is not valid meal data: serving the day without its meals`,
    );
  } else if (meals.length) {
    day.meals = meals;
  }
  return day;
}

const measureFromRow = (row: Row): MeasureEntry => ({
  date: text(row, 'date'),
  chest: numOrNull(row, 'chest'),
  waist: numOrNull(row, 'waist'),
  hips: numOrNull(row, 'hips'),
});

function foodFromRow(row: Row): FoodItem {
  const food: FoodItem = {
    name: text(row, 'name'),
    portion: text(row, 'portion'),
    kcal: num(row, 'kcal'),
    count: num(row, 'count'),
    lastUsed: text(row, 'last_used'),
  };
  // NULL = unknown: the key is omitted, as in useFood().
  for (const key of MACRO_KEYS) {
    const v = numOrNull(row, key);
    if (v !== null) food[key] = v;
  }
  return food;
}

export function createDataRepos(
  db: Database,
  now: () => number = Date.now,
  logger: Logger = silentLogger,
): DataRepos {
  // Prepared once for every user; each statement binds the user id first.
  const q = {
    allDays: db.prepare(
      'SELECT date, food, kcal, trained, types, notes, photos, meals FROM days WHERE user_id = ? ORDER BY date',
    ),
    getDay: db.prepare(
      'SELECT date, food, kcal, trained, types, notes, photos, meals FROM days WHERE user_id = ? AND date = ?',
    ),
    allWeights: db.prepare('SELECT date, kg FROM weights WHERE user_id = ? ORDER BY date'),
    allMeasures: db.prepare('SELECT date, chest, waist, hips FROM measures WHERE user_id = ? ORDER BY date'),
    // `position` keeps the array order of AppData.foods, so reads equal what applyOp() produces.
    allFoods: db.prepare(
      `SELECT name, portion, kcal, count, last_used, protein, fat, carbs FROM foods WHERE user_id = ?
       ORDER BY position`,
    ),
    // `meals` is in the update list too: a legacy write must clear a stale meal list.
    putDay: db.prepare(
      `INSERT INTO days (user_id, date, food, kcal, trained, types, notes, photos, meals, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET food = excluded.food, kcal = excluded.kcal,
         trained = excluded.trained, types = excluded.types, notes = excluded.notes, photos = excluded.photos,
         meals = excluded.meals, updated_at = excluded.updated_at`,
    ),
    deleteDay: db.prepare('DELETE FROM days WHERE user_id = ? AND date = ?'),
    putWeight: db.prepare(
      `INSERT INTO weights (user_id, date, kg, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
    ),
    deleteWeight: db.prepare('DELETE FROM weights WHERE user_id = ? AND date = ?'),
    putMeasure: db.prepare(
      `INSERT INTO measures (user_id, date, chest, waist, hips, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET chest = excluded.chest, waist = excluded.waist,
         hips = excluded.hips, updated_at = excluded.updated_at`,
    ),
    deleteMeasure: db.prepare('DELETE FROM measures WHERE user_id = ? AND date = ?'),
    insertFood: db.prepare(
      `INSERT INTO foods (user_id, key, position, name, portion, kcal, count, last_used, protein, fat, carbs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    hasWeight: db.prepare('SELECT 1 AS found FROM weights WHERE user_id = ? AND date = ?'),
    hasMeasure: db.prepare('SELECT 1 AS found FROM measures WHERE user_id = ? AND date = ?'),
    dayTrained: db.prepare('SELECT trained FROM days WHERE user_id = ? AND date = ?'),
    getSettings: db.prepare('SELECT value FROM user_settings WHERE user_id = ?'),
    putSettings: db.prepare(
      `INSERT INTO user_settings (user_id, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ),
    // replaceAll: one scoped statement per table (never a multi-statement exec).
    clearDays: db.prepare('DELETE FROM days WHERE user_id = ?'),
    clearWeights: db.prepare('DELETE FROM weights WHERE user_id = ?'),
    clearMeasures: db.prepare('DELETE FROM measures WHERE user_id = ?'),
    clearFoods: db.prepare('DELETE FROM foods WHERE user_id = ?'),
  };

  function forUser(id: UserId): DataRepo {
    function readSettings(): Settings {
      const row = q.getSettings.get(id);
      if (!row) return normalizeSettings(null);
      try {
        const parsed: unknown = JSON.parse(text(row, 'value'));
        // Older rows may miss newer fields: fill them in first, then validate the result.
        const candidate = normalizeSettings(isRecord(parsed) ? (parsed as Partial<Settings>) : null);
        const result = settingsSchema.safeParse(candidate);
        if (result.success) return result.data;
      } catch {
        // fall through to defaults
      }
      logger.warn(`Stored settings of user ${id} are invalid, serving defaults until the next settings.put`);
      return normalizeSettings(null);
    }

    const writeSettings = (s: Settings): void => {
      q.putSettings.run(id, JSON.stringify(s), now());
    };

    const readFoods = (): FoodItem[] => q.allFoods.all(id).map(foodFromRow);

    /** At most 200 small rows: rewriting them all keeps the stored order identical to the array. */
    function writeFoods(foods: readonly FoodItem[]): void {
      q.clearFoods.run(id);
      foods.forEach((f, position) =>
        q.insertFood.run(
          id,
          foodKey(f.name),
          position,
          f.name,
          f.portion,
          f.kcal,
          f.count,
          f.lastUsed,
          f.protein ?? null,
          f.fat ?? null,
          f.carbs ?? null,
        ),
      );
    }

    function readDay(date: ISODate): DayEntry | undefined {
      const row = q.getDay.get(id, date);
      return row ? dayFromRow(row, logger) : undefined;
    }

    /** Stores an already normalised, non-empty day: the derived columns and the meals (NULL for a legacy day). */
    function writeDay(date: ISODate, entry: DayEntry, at: number): void {
      q.putDay.run(
        id,
        date,
        entry.food,
        entry.kcal,
        trainedToSql(entry.trained),
        JSON.stringify(entry.types),
        entry.notes,
        JSON.stringify(entry.photos ?? []),
        entry.meals?.length ? JSON.stringify(entry.meals) : null,
        at,
      );
    }

    /** One day op through the shared reducer, on the stored day. */
    function applyDayOp(op: DayOp, at: number): void {
      const next = reduceDay(readDay(op.date), op);
      if (next) writeDay(op.date, next, at);
      else q.deleteDay.run(id, op.date);
    }

    function putMeasure(date: ISODate, value: MeasureValues, at: number): void {
      if (isEmptyMeasure(value)) q.deleteMeasure.run(id, date);
      else q.putMeasure.run(id, date, value.chest, value.waist, value.hips, at);
    }

    type RowOp = Exclude<Op, DayOp | { kind: 'food.use' | 'food.delete' }>;

    function applyRowOp(op: RowOp, at: number): void {
      switch (op.kind) {
        case 'weight.put':
          q.putWeight.run(id, op.date, op.kg, at);
          return;
        case 'weight.delete':
          q.deleteWeight.run(id, op.date);
          return;
        case 'measure.put':
          return putMeasure(op.date, op.value, at);
        case 'measure.delete':
          q.deleteMeasure.run(id, op.date);
          return;
        case 'settings.put':
          // An absent mealTypes / macroGoals (old clients) keeps the stored value.
          return writeSettings(mergeSettingsPut(readSettings(), op.value));
      }
    }

    return {
      read(): AppData {
        const days: Record<ISODate, DayEntry> = {};
        for (const row of q.allDays.all(id)) days[text(row, 'date')] = dayFromRow(row, logger);
        const weights: WeightEntry[] = q.allWeights
          .all(id)
          .map((row) => ({ date: text(row, 'date'), kg: num(row, 'kg') }));
        const measures = q.allMeasures.all(id).map(measureFromRow);
        return { days, weights, measures, foods: readFoods(), settings: readSettings() };
      },

      settings: readSettings,

      apply(ops) {
        const at = now();
        transaction(db, () => {
          // Food ops reuse the shared reducer: read once, fold the batch's food ops, write once.
          let foods: FoodItem[] | null = null;
          for (const op of ops) {
            if (op.kind === 'food.use') {
              foods = useFood(foods ?? readFoods(), op.value, op.date);
            } else if (op.kind === 'food.delete') {
              const key = foodKey(op.name);
              foods = (foods ?? readFoods()).filter((f) => foodKey(f.name) !== key);
            } else if (isDayOp(op)) {
              applyDayOp(op, at);
            } else {
              applyRowOp(op, at);
            }
          }
          if (foods) writeFoods(foods);
        });
      },

      replaceAll(data) {
        const at = now();
        transaction(db, () => {
          q.clearDays.run(id);
          q.clearWeights.run(id);
          q.clearMeasures.run(id);
          // Re-normalised: the derived fields of days with meals are recomputed; `meals: []` is a legacy day.
          for (const [date, entry] of Object.entries(data.days)) {
            const day = normalizeDay(entry);
            if (!isEmptyDay(day)) writeDay(date, day, at);
          }
          for (const w of data.weights) q.putWeight.run(id, w.date, w.kg, at);
          for (const m of data.measures) putMeasure(m.date, m, at);
          writeFoods(data.foods);
          writeSettings(data.settings);
        });
      },

      setTimezone(timeZone) {
        const zone = canonicalTimeZone(timeZone);
        return transaction(db, () => {
          const current = readSettings();
          if (canonicalTimeZone(current.timezone) === zone) return null;
          writeSettings({ ...current, timezone: zone });
          return zone;
        });
      },

      isDone(kind, date) {
        switch (kind) {
          case 'weigh':
            return q.hasWeight.get(id, date) !== undefined;
          case 'measure':
            return q.hasMeasure.get(id, date) !== undefined;
          case 'workout': {
            const row = q.dayTrained.get(id, date);
            return row !== undefined && numOrNull(row, 'trained') !== null;
          }
        }
      },
    };
  }

  return { forUser };
}
