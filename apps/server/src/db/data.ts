import {
  isEmptyDay,
  isEmptyMeasure,
  normalizeDay,
  normalizeSettings,
  settingsSchema,
  type AppData,
  type DayEntry,
  type ISODate,
  type MeasureEntry,
  type MeasureValues,
  type Op,
  type ReminderKind,
  type Settings,
  type WeightEntry,
} from '@legko/shared';
import { silentLogger, type Logger } from '../logger';
import { getKv, KV, setKv } from './kv';
import { num, numOrNull, text } from './rows';
import type { Database, Row } from './sqlite';
import { transaction } from './tx';

/**
 * Persistence of `AppData`. Writes follow `applyOp()` from `@legko/shared` exactly:
 * days are normalised (`normalizeDay`), an empty day or an empty measurement is a delete,
 * and puts are upserts keyed by date.
 */
export interface DataRepo {
  read(): AppData;
  /** Stored settings filled in with defaults (`normalizeSettings`), defaults when never saved. */
  settings(): Settings;
  /** Applies already-validated ops in order, in one transaction. */
  apply(ops: readonly Op[]): void;
  /** Replaces everything (import) in one transaction. */
  replaceAll(data: AppData): void;
  /** Stores a new `settings.timezone`; returns false when it was already set. */
  setTimezone(timeZone: string): boolean;
  /** Whether the action a reminder asks for was already recorded for `date`. */
  isDone(kind: ReminderKind, date: ISODate): boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const trainedToSql = (t: boolean | null): number | null => (t === null ? null : t ? 1 : 0);
const trainedFromSql = (v: number | null): boolean | null => (v === null ? null : v === 1);

function parseTypes(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError('days.types: expected a JSON array');
  return parsed.filter((t): t is string => typeof t === 'string');
}

const dayFromRow = (row: Row): DayEntry => ({
  food: text(row, 'food'),
  kcal: numOrNull(row, 'kcal'),
  trained: trainedFromSql(numOrNull(row, 'trained')),
  types: parseTypes(text(row, 'types')),
  notes: text(row, 'notes'),
});

const measureFromRow = (row: Row): MeasureEntry => ({
  date: text(row, 'date'),
  chest: numOrNull(row, 'chest'),
  waist: numOrNull(row, 'waist'),
  hips: numOrNull(row, 'hips'),
});

export function createDataRepo(
  db: Database,
  now: () => number = Date.now,
  logger: Logger = silentLogger,
): DataRepo {
  const q = {
    allDays: db.prepare('SELECT date, food, kcal, trained, types, notes FROM days ORDER BY date'),
    allWeights: db.prepare('SELECT date, kg FROM weights ORDER BY date'),
    allMeasures: db.prepare('SELECT date, chest, waist, hips FROM measures ORDER BY date'),
    putDay: db.prepare(
      `INSERT INTO days (date, food, kcal, trained, types, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET food = excluded.food, kcal = excluded.kcal, trained = excluded.trained,
         types = excluded.types, notes = excluded.notes, updated_at = excluded.updated_at`,
    ),
    deleteDay: db.prepare('DELETE FROM days WHERE date = ?'),
    putWeight: db.prepare(
      `INSERT INTO weights (date, kg, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
    ),
    deleteWeight: db.prepare('DELETE FROM weights WHERE date = ?'),
    putMeasure: db.prepare(
      `INSERT INTO measures (date, chest, waist, hips, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET chest = excluded.chest, waist = excluded.waist, hips = excluded.hips,
         updated_at = excluded.updated_at`,
    ),
    deleteMeasure: db.prepare('DELETE FROM measures WHERE date = ?'),
    hasWeight: db.prepare('SELECT 1 AS found FROM weights WHERE date = ?'),
    hasMeasure: db.prepare('SELECT 1 AS found FROM measures WHERE date = ?'),
    dayTrained: db.prepare('SELECT trained FROM days WHERE date = ?'),
  };

  function readSettings(): Settings {
    const raw = getKv(db, KV.settings);
    if (raw === null) return normalizeSettings(null);
    try {
      const parsed: unknown = JSON.parse(raw);
      // Older rows may miss newer fields: fill them in first, then validate the result.
      const candidate = normalizeSettings(isRecord(parsed) ? (parsed as Partial<Settings>) : null);
      const result = settingsSchema.safeParse(candidate);
      if (result.success) return result.data;
    } catch {
      // fall through to defaults
    }
    logger.warn('Stored settings are invalid, serving defaults until the next settings.put');
    return normalizeSettings(null);
  }

  const writeSettings = (s: Settings): void => setKv(db, KV.settings, JSON.stringify(s));

  function putDay(date: ISODate, value: DayEntry, at: number): void {
    const entry = normalizeDay(value);
    if (isEmptyDay(entry)) {
      q.deleteDay.run(date);
      return;
    }
    q.putDay.run(
      date,
      entry.food,
      entry.kcal,
      trainedToSql(entry.trained),
      JSON.stringify(entry.types),
      entry.notes,
      at,
    );
  }

  function putMeasure(date: ISODate, value: MeasureValues, at: number): void {
    if (isEmptyMeasure(value)) q.deleteMeasure.run(date);
    else q.putMeasure.run(date, value.chest, value.waist, value.hips, at);
  }

  function applyOne(op: Op, at: number): void {
    switch (op.kind) {
      case 'day.put':
        return putDay(op.date, op.value, at);
      case 'day.delete':
        q.deleteDay.run(op.date);
        return;
      case 'weight.put':
        q.putWeight.run(op.date, op.kg, at);
        return;
      case 'weight.delete':
        q.deleteWeight.run(op.date);
        return;
      case 'measure.put':
        return putMeasure(op.date, op.value, at);
      case 'measure.delete':
        q.deleteMeasure.run(op.date);
        return;
      case 'settings.put':
        return writeSettings(op.value);
    }
  }

  return {
    read(): AppData {
      const days: Record<ISODate, DayEntry> = {};
      for (const row of q.allDays.all()) days[text(row, 'date')] = dayFromRow(row);
      const weights: WeightEntry[] = q.allWeights
        .all()
        .map((row) => ({ date: text(row, 'date'), kg: num(row, 'kg') }));
      const measures = q.allMeasures.all().map(measureFromRow);
      return { days, weights, measures, settings: readSettings() };
    },

    settings: readSettings,

    apply(ops) {
      const at = now();
      transaction(db, () => {
        for (const op of ops) applyOne(op, at);
      });
    },

    replaceAll(data) {
      const at = now();
      transaction(db, () => {
        db.exec('DELETE FROM days; DELETE FROM weights; DELETE FROM measures;');
        for (const [date, entry] of Object.entries(data.days)) putDay(date, entry, at);
        for (const w of data.weights) q.putWeight.run(w.date, w.kg, at);
        for (const m of data.measures) putMeasure(m.date, m, at);
        writeSettings(data.settings);
      });
    },

    setTimezone(timeZone) {
      return transaction(db, () => {
        const current = readSettings();
        if (current.timezone === timeZone) return false;
        writeSettings({ ...current, timezone: timeZone });
        return true;
      });
    },

    isDone(kind, date) {
      switch (kind) {
        case 'weigh':
          return q.hasWeight.get(date) !== undefined;
        case 'measure':
          return q.hasMeasure.get(date) !== undefined;
        case 'workout': {
          const row = q.dayTrained.get(date);
          return row !== undefined && numOrNull(row, 'trained') !== null;
        }
      }
    },
  };
}
