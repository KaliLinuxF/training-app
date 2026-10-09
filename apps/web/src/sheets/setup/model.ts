/**
 * First-run setup sheet: current weight (saved as today's weigh-in), goal weight, daily kcal goal
 * and optional measurements. Saving marks the settings as onboarded.
 */
import { LIMITS, num, str, type AppData, type ISODate, type Op, type Settings } from '@legko/shared';
import {
  FIELD_ERRORS,
  kgError,
  measureError,
  measureValues,
  type MeasureError,
  type MeasureTexts,
} from '../validation';

export const SETUP_HEADING = 'Налаштування';
export const SETUP_INTRO = 'Ці дані потрібні, щоб рахувати прогрес. Змінити їх можна будь-коли в «Нагадуваннях».';

export interface SetupDraft extends MeasureTexts {
  /** Current weight → today's weigh-in. */
  weight: string;
  goal: string;
  kcalGoal: string;
}

export function initSetupDraft(data: AppData, today: ISODate): SetupDraft {
  const w = data.weights.find((x) => x.date === today);
  const m = data.measures.find((x) => x.date === today);
  return {
    weight: str(w?.kg),
    goal: str(data.settings.goal),
    kcalGoal: String(data.settings.kcalGoal),
    chest: str(m?.chest),
    waist: str(m?.waist),
    hips: str(m?.hips),
  };
}

export const isSetupDirty = (a: SetupDraft, b: SetupDraft): boolean =>
  a.weight !== b.weight ||
  a.goal !== b.goal ||
  a.kcalGoal !== b.kcalGoal ||
  a.chest !== b.chest ||
  a.waist !== b.waist ||
  a.hips !== b.hips;

export interface SetupErrors {
  weight?: string;
  goal?: string;
  kcalGoal?: string;
  measure: MeasureError;
}

function goalError(text: string): string | undefined {
  return text.trim() ? kgError(text) : FIELD_ERRORS.goalRequired;
}

function kcalGoalError(text: string): string | undefined {
  if (!text.trim()) return FIELD_ERRORS.kcalGoalRequired;
  const n = num(text);
  return n == null || n < LIMITS.goalKcal.min || n > LIMITS.goalKcal.max ? FIELD_ERRORS.kcalGoal : undefined;
}

export function validateSetup(draft: SetupDraft): SetupErrors {
  return {
    weight: kgError(draft.weight),
    goal: goalError(draft.goal),
    kcalGoal: kcalGoalError(draft.kcalGoal),
    measure: measureError(draft),
  };
}

export const hasSetupErrors = (e: SetupErrors): boolean =>
  e.weight !== undefined || e.goal !== undefined || e.kcalGoal !== undefined || e.measure.message !== undefined;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * «Почати»: today's weigh-in and measurements when given (left untouched when empty),
 * then the goals with `onboarded: true`. Call only when `validateSetup` found no errors.
 */
export function setupOps(draft: SetupDraft, settings: Settings, today: ISODate): Op[] {
  const ops: Op[] = [];
  const kg = num(draft.weight);
  if (kg != null) ops.push({ kind: 'weight.put', date: today, kg });
  const m = measureValues(draft);
  if (m.chest != null || m.waist != null || m.hips != null) ops.push({ kind: 'measure.put', date: today, value: m });
  const goal = num(draft.goal);
  const kcalGoal = num(draft.kcalGoal);
  ops.push({
    kind: 'settings.put',
    value: {
      ...settings,
      goal: goal != null ? round1(goal) : settings.goal,
      kcalGoal: kcalGoal != null ? Math.round(kcalGoal) : settings.kcalGoal,
      onboarded: true,
    },
  });
  return ops;
}
