/**
 * The day's food as the «Їжа» list and the «Запис дня» food field show it (docs/meals-macros.md §7.2, §7.5): one row
 * per meal (a legacy day = one block «Їжа за день»), the totals card (kcal and Б · Ж · В against her goals) and the
 * one-line total of the day field. Pure: the screens only lay this out.
 */
import {
  f0,
  LEGACY_MEAL_ID,
  LIMITS,
  MACRO_KEYS,
  mealContent,
  type AppData,
  type ISODate,
  type MacroKey,
  type Meal,
} from '@legko/shared';
import { kcalGoalView, type KcalGoalState } from '@/features/goal';
import {
  dayNutrition,
  macroGoalView,
  macroLine,
  macroParts,
  MACRO_LABELS,
  mealTitle,
  NBSP,
  PART_SEPARATOR,
  type MacroGoalState,
} from '@/lib/nutrition';

/** Muted line of an empty day in the «Їжа» sheet. */
export const EMPTY_DAY_TEXT = 'Ще нічого не записано за цей день';
/** The same in the «Запис дня» food field (the field label already says «Їжа»). */
export const EMPTY_FIELD_TEXT = 'Ще нічого не записано';
/** Under the list when a block from the old version (no type) is there. */
export const LEGACY_NOTE = 'Запис зі старої версії — відкрий його, щоб обрати тип прийому.';
/** Under the totals when some meal with energy has no Б · Ж · В (the sums are a lower bound, D22). */
export const PARTIAL_NOTE = 'Б · Ж · В пораховано не для всіх прийомів';
/** Why «+ Прийом їжі» does nothing on a full day (D23). */
export const MEALS_CAP_NOTE = `Не більше ${LIMITS.mealsPerDay} прийомів на день`;
/** Visible text of «+ Прийом їжі» and its accessible name. */
export const ADD_MEAL_TEXT = '+ Прийом їжі';
export const ADD_MEAL_LABEL = 'Додати прийом їжі';
/** The region of meal rows: the same name in both sheets, so the e2e helpers find it in either. */
export const MEALS_REGION = 'Прийоми їжі';

export interface FoodDayRow {
  id: string;
  /** «Сніданок», «Їжа за день», «Прийом їжі». */
  title: string;
  /** «08:30», or null. */
  time: string | null;
  /** «Тост з тунцем, кава» (one line), or ''. */
  content: string;
  /** «Б 27 · Ж 11 · В 36 г» without goals; null when no macro is known. */
  macros: string | null;
  /** «420 ккал», or «—» without kcal. */
  value: string;
  hasKcal: boolean;
  /** «Сніданок о 08:30: тост з тунцем, кава. 420 ккал, білки 27, жири 11, вуглеводи 36 г». */
  label: string;
  photos: string[];
}

/** `ink` below the goal, `acc2` exactly on it, `acc` above it (lavender, never red). */
export type GoalTone = 'ink' | 'acc' | 'acc2';

export interface KcalTotalView {
  /** «1 240», or «—». */
  value: string;
  /** « / 1 700 ккал». */
  goal: string;
  /** kcalGoalView text: «Залишилось 460 з 1 700 ккал». */
  text: string;
  /** For VoiceOver instead of the slash: «1 240 з 1 700 ккал»; null when nothing is counted (the text says it). */
  speech: string | null;
  state: KcalGoalState;
  tone: GoalTone;
  /** Bar fill 0–100. */
  pct: number;
}

export interface MacroTotalView {
  key: MacroKey;
  /** «Білки». */
  name: string;
  /** What is shown: «68 / 90 г», «68 г», «— / 90 г», «—». */
  value: string;
  /** What VoiceOver reads after the name: «68 з 90 г», «95 з 90 г, більше цілі», «ще не пораховано». */
  speech: string;
  state: MacroGoalState;
  tone: GoalTone;
  /** A goal is set: the row has a bar. */
  hasGoal: boolean;
  pct: number;
}

export interface FoodDayTotals {
  kcal: KcalTotalView;
  /** Б · Ж · В rows: shown when some macro is known or some goal is set, else null. */
  macros: MacroTotalView[] | null;
  /** `PARTIAL_NOTE` when a shown sum misses some meal, else null. */
  partialNote: string | null;
}

export interface FoodDayModel {
  rows: FoodDayRow[];
  totals: FoodDayTotals;
  /** `LEGACY_NOTE` when a block from the old version (untyped) is listed, else null. */
  legacyNote: string | null;
  /** Fewer than 20 meals: «+ Прийом їжі» can add one. */
  canAdd: boolean;
  /** «Разом 980 / 1 700 ккал · Б 48 · Ж 30 · В 100 г» (wraps only after «·»); null on an empty day. */
  totalLine: string | null;
}

const toneOf = (state: KcalGoalState | MacroGoalState): GoalTone =>
  state === 'over' ? 'acc' : state === 'reached' ? 'acc2' : 'ink';

const kcalText = (kcal: number): string => `${f0(kcal)}${NBSP}ккал`;

/** «Тост з тунцем» → «тост з тунцем» inside a sentence (an acronym such as «ЗСУ» keeps its case). */
function lowerFirst(text: string): string {
  const [first = '', second = ''] = text;
  if (!first || first === first.toLocaleLowerCase('uk')) return text;
  if (second && second !== second.toLocaleLowerCase('uk')) return text;
  return first.toLocaleLowerCase('uk') + text.slice(first.length);
}

const upperFirst = (text: string): string =>
  text ? text.charAt(0).toLocaleUpperCase('uk') + text.slice(1) : text;

/** «білки 27, жири 11, вуглеводи 36 г» (known parts only), or null. */
function macroWords(meal: Meal): string | null {
  const parts = macroParts(meal).filter((p) => p.known);
  if (!parts.length) return null;
  return `${parts.map((p) => `${MACRO_LABELS[p.key].lower} ${p.value}`).join(', ')} г`;
}

/** The accessible name of a meal row; the parts she has not recorded are left out. */
export function mealRowLabel(meal: Meal): string {
  const title = mealTitle(meal);
  const time = meal.time ? ` о ${meal.time}` : '';
  const content = mealContent(meal);
  const head = `${title}${time}${content ? `: ${lowerFirst(content)}` : ''}`;
  const tail = [meal.kcal !== null ? kcalText(meal.kcal) : null, macroWords(meal)].filter(
    (p): p is string => p !== null,
  );
  return tail.length ? `${head}. ${upperFirst(tail.join(', '))}` : head;
}

export function mealRow(meal: Meal): FoodDayRow {
  const hasKcal = meal.kcal !== null;
  return {
    id: meal.id,
    title: mealTitle(meal),
    time: meal.time,
    content: mealContent(meal),
    macros: macroLine(meal),
    value: meal.kcal !== null ? kcalText(meal.kcal) : '—',
    hasKcal,
    label: mealRowLabel(meal),
    photos: [...(meal.photos ?? [])],
  };
}

/** A block from before meals existed (or an old client's addition) that she has not given a type yet. */
const isOldBlock = (meal: Meal): boolean =>
  meal.type.trim() === '' && (meal.id === LEGACY_MEAL_ID || meal.id.startsWith('old-'));

export function foodDayModel(data: AppData, date: ISODate): FoodDayModel {
  const day = data.days[date];
  const n = dayNutrition(day);
  const { kcalGoal, macroGoals } = data.settings;

  const kv = kcalGoalView(n.kcal, kcalGoal);
  const kcal: KcalTotalView = {
    value: n.kcal !== null ? f0(n.kcal) : '—',
    goal: ` / ${f0(kcalGoal)}${NBSP}ккал`,
    text: kv.text,
    speech: n.kcal !== null ? `${f0(n.kcal)} з ${f0(kcalGoal)} ккал` : null,
    state: kv.state,
    tone: toneOf(kv.state),
    pct: kv.pct,
  };

  const anyGoal = MACRO_KEYS.some((k) => macroGoals[k] !== null);
  const macroViews = MACRO_KEYS.map((key): MacroTotalView => {
    const v = macroGoalView(key, n.macros[key], macroGoals[key]);
    const name = MACRO_LABELS[key].name;
    const value = v.goal !== null ? `${v.value} / ${v.goal} г` : v.value === '—' ? '—' : `${v.value} г`;
    return {
      key,
      name,
      value,
      speech: v.label.startsWith(`${name}: `) ? v.label.slice(name.length + 2) : v.label,
      state: v.state,
      tone: toneOf(v.state),
      hasGoal: v.goal !== null,
      pct: v.pct,
    };
  });
  const showMacros = n.hasMacros || anyGoal;
  const partial = macroParts(n.macros, macroGoals, n.complete).some((p) => p.partial);

  const rows = n.meals.map(mealRow);
  const goalText = `${f0(kcalGoal)}${NBSP}ккал`;
  const dayKcal = n.kcal !== null ? f0(n.kcal) : '—';
  const line = macroLine(n.macros);
  const totalLine = rows.length
    ? `Разом${NBSP}${dayKcal}${NBSP}/${NBSP}${goalText}${line ? `${PART_SEPARATOR}${line}` : ''}`
    : null;

  return {
    rows,
    totals: {
      kcal,
      macros: showMacros ? macroViews : null,
      partialNote: showMacros && partial ? PARTIAL_NOTE : null,
    },
    legacyNote: n.meals.some(isOldBlock) ? LEGACY_NOTE : null,
    canAdd: n.count < LIMITS.mealsPerDay,
    totalLine,
  };
}
