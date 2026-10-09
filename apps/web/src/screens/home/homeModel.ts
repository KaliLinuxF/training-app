/**
 * Home «Головна» view model (redesign A «Чек-лист дня»): header, at most one banner, the compact hero,
 * the four «Сьогодні» rows (Їжа, Тренування, Вага, Заміри) and the week row.
 * Every visible string and every accessible name is formatted here, so the components only lay them out.
 */
import {
  dLong,
  dWeekdayLong,
  f0,
  f1,
  fN,
  sgn,
  weekdayOf,
  type AppData,
  type DayEntry,
  type ISODate,
  type MeasureEntry,
  type MeasureKey,
  type WeeklyReminder,
} from '@legko/shared';
import { kcalGoalView } from '@/features/goal';
import {
  MEASURE_LABELS,
  MEASURE_PARAMS,
  measureCheck,
  measureSummary,
  weekSummary,
  weighCheck,
  weightSummary,
  type WeeklyCheck,
} from '@/lib/stats';
import { greeting } from '@/lib/useToday';
import type { SheetMode, SheetPatch } from '@/store/ui';

/** The four action rows of «Сьогодні». */
export type HomeRowId = 'food' | 'workout' | 'weight' | 'measure';

/** Which sheet a row or banner opens for today. */
export interface HomeAction {
  mode: SheetMode;
  patch?: SheetPatch;
}

/** Each «Сьогодні» row opens its short sheet (no patch: the ✓ / ✕ save inline). */
export const HOME_ROW_ACTIONS: Readonly<Record<HomeRowId, HomeAction>> = {
  food: { mode: 'food' },
  workout: { mode: 'workout' },
  weight: { mode: 'weight' },
  measure: { mode: 'measure' },
};

export type HomeBannerId = 'setup' | 'install';

export interface HomeBanner {
  id: HomeBannerId;
  title: string;
  sub: string;
  cta: string;
  action: HomeAction;
  /** Has a «Сховати» ✕ (the install hint). */
  dismissible: boolean;
}

export interface HomeHero {
  /** Latest weigh-in, «65,4» | «—». */
  current: string;
  /** Signed change since the start, «−2,9 кг»; `null` without weigh-ins (no badge). */
  badge: string | null;
  /** Screen-reader prefix of the badge: «Втрачено від старту» | «Набрано від старту» | «Зміна від старту». */
  badgeSr: string;
  /** Progress bar width, 0–100. */
  pct: number;
  /** «35%»; '' without weigh-ins. */
  progress: string;
  /** Still to lose, «5,4 кг». */
  left: string;
  /** «Ціль 60,0 кг» (shown instead of the progress line before the first weigh-in). */
  goal: string;
  /** Weigh-ins exist and the goal weight is reached. */
  reached: boolean;
}

export type HomeFoodState = 'empty' | 'recorded' | 'ok' | 'reached' | 'over';

export interface HomeFoodRow {
  state: HomeFoodState;
  /** «1 650» | «—» | «Записано». */
  value: string;
  /** « / 1 700 ккал» (13 muted, after the number); `null` for «Записано». */
  goal: string | null;
  /** Decorative bar under the title (mint ≤ goal, lavender over); `null` for «Записано». */
  meter: { value: number; tone: 'acc' | 'acc2' } | null;
  /** «Калорії не вказані» (food recorded without kcal), else `null`. */
  sub: string | null;
  /** Accessible name, «Їжа: …». */
  label: string;
}

export interface HomeTrainingRow {
  /** Pressed option of the inline ✓ / ✕. */
  trained: boolean | null;
  /** «За планом о 18:00» | «Ще не відмічено» | «Кардіо, Прес» | «Було · додай тип» | «Не було». */
  sub: string;
  /** `undefined` = the row's default sub colour. */
  subTone: 'muted' | 'acc' | undefined;
  /** A planned workout day that is not marked yet. */
  due: boolean;
  /** Accessible name, «Тренування: …». */
  label: string;
}

export interface HomeScheduleRow {
  /** «12 жовтня — 65,4 кг» | «Груди 90 · Талія 70 · Стегна 98» | «Сьогодні — 65,0 кг» | «Ще немає зважувань». */
  sub: string;
  /** «✓ » (done today, mint) or «Пропущено · » (missed, lavender) before the sub. */
  prefix: { text: string; tone: 'acc' | 'acc2' } | null;
  /** Right side: a «Сьогодні» pill, a date without the time, or «вимкнено». */
  next: { kind: 'due' | 'date' | 'off'; text: string };
  /** Accessible name, «Вага: …» / «Заміри: …» (with the reminder time). */
  label: string;
}

export interface HomeWeek {
  /** «2 з 3 трен. · сер. 1 795 ккал» */
  text: string;
  /** «Тиждень: 2 з 3 тренувань, середня калорійність 1 795 ккал. Відкрити прогрес» */
  label: string;
  href: '/progress?period=week';
}

export interface HomeModel {
  /** «Середа, 14 жовтня» */
  todayLabel: string;
  /** «Доброго ранку» */
  greeting: string;
  /** Show the «Офлайн» note under the header. */
  offline: boolean;
  /** At most one: setup (not onboarded) > install hint > none. */
  banner: HomeBanner | null;
  hero: HomeHero;
  rows: {
    food: HomeFoodRow;
    workout: HomeTrainingRow;
    weight: HomeScheduleRow;
    measure: HomeScheduleRow;
  };
  week: HomeWeek;
}

export interface HomeModelOptions {
  /** Current time, for the greeting. */
  now: Date;
  online: boolean;
  /** iPhone in Safari and the hint was not dismissed. */
  showInstallHint: boolean;
}

export const OFFLINE_NOTE = 'Офлайн · зміни збережено на телефоні';

const DASH = '—';
/** No-break space (U+00A0). */
const NB = '\u00a0';
const WEEK_HREF = '/progress?period=week';

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** «2 тренування», «5 тренувань» (1 / 21 тренування, 2–4 тренування, 0 / 5+ / 11–14 тренувань). */
function trainingsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 1 && mod10 <= 4 && !(mod100 >= 11 && mod100 <= 14) ? 'тренування' : 'тренувань';
}

/** After «з N» (genitive): «з 1 тренування», «з 3 тренувань». */
const ofTrainingsWord = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'тренування' : 'тренувань');

function buildBanner(data: AppData, showInstallHint: boolean): HomeBanner | null {
  if (!data.settings.onboarded) {
    return {
      id: 'setup',
      title: 'Почнімо',
      // Short on purpose: the kit's compact banner clamps the sub to 2 lines, and next to the wide «Налаштувати»
      // the text column is ~115–185px on the phone (320–390). The longer sentence needed a 3rd line and was cut.
      sub: 'Запиши стартову вагу й ціль',
      cta: 'Налаштувати',
      action: { mode: 'setup' },
      dismissible: false,
    };
  }
  if (showInstallHint) {
    return {
      id: 'install',
      title: 'Встанови Легко на iPhone',
      sub: 'Так працюватимуть нагадування',
      cta: 'Як?',
      action: { mode: 'install' },
      dismissible: true,
    };
  }
  return null;
}

function buildHero(data: AppData): HomeHero {
  const w = weightSummary(data);
  const lost = w.lost;
  return {
    current: w.last ? f1(w.last.kg) : DASH,
    badge: lost !== null ? `${sgn(-lost, f1)} кг` : null,
    badgeSr:
      lost !== null && lost > 0.04
        ? 'Втрачено від старту'
        : lost !== null && lost < -0.04
          ? 'Набрано від старту'
          : 'Зміна від старту',
    pct: w.pct,
    progress: w.last ? `${Math.round(w.pct)}%` : '',
    left: `${f1(w.left)} кг`,
    goal: `Ціль ${f1(w.goal)} кг`,
    reached: w.last !== null && w.left === 0,
  };
}

const hasFood = (e: DayEntry | undefined): boolean =>
  !!e && (e.food.trim() !== '' || (e.photos?.length ?? 0) > 0);

function buildFood(data: AppData, today: ISODate): HomeFoodRow {
  const entry = data.days[today];
  const kcalGoal = data.settings.kcalGoal;
  const view = kcalGoalView(entry?.kcal, kcalGoal);
  const goal = ` / ${f0(kcalGoal)} ккал`;
  if (view.state === 'empty') {
    if (hasFood(entry)) {
      return {
        state: 'recorded',
        value: 'Записано',
        goal: null,
        meter: null,
        sub: 'Калорії не вказані',
        label: `Їжа: записано, калорії не вказані. ${view.label}`,
      };
    }
    return {
      state: 'empty',
      value: DASH,
      goal,
      meter: { value: 0, tone: 'acc2' },
      sub: null,
      label: `Їжа: ще нічого не записано. ${view.label}`,
    };
  }
  return {
    state: view.state,
    value: f0(entry?.kcal),
    goal,
    meter: { value: view.pct, tone: view.state === 'over' ? 'acc' : 'acc2' },
    sub: null,
    label: `Їжа: ${view.label}`,
  };
}

function buildWorkout(data: AppData, today: ISODate): HomeTrainingRow {
  const entry = data.days[today];
  const { onboarded, rem } = data.settings;
  const trained = entry?.trained ?? null;
  let sub: string;
  let subTone: HomeTrainingRow['subTone'];
  let due = false;
  let label: string;
  if (trained === true) {
    const types = entry?.types.join(', ') ?? '';
    sub = types || 'Було · додай тип';
    subTone = types ? undefined : 'acc';
    label = types ? `Тренування: ${types}` : `Тренування: ${lowerFirst(sub)}`;
  } else if (trained === false) {
    sub = 'Не було';
    subTone = undefined;
    label = `Тренування: ${lowerFirst(sub)}`;
  } else if (onboarded && rem.workout.on && rem.workout.days.includes(weekdayOf(today))) {
    sub = `За планом о ${rem.workout.time}`;
    subTone = 'acc';
    due = true;
    label = `Тренування: ${lowerFirst(sub)}`;
  } else {
    sub = 'Ще не відмічено';
    subTone = 'muted';
    label = `Тренування: ${lowerFirst(sub)}`;
  }
  return { trained, sub, subTone, due, label };
}

/** Wording of the weigh-in / measurement rows. */
interface ScheduleCopy {
  title: string;
  /** «зважування» / «заміри» — what is due today. */
  action: string;
  /** «Останнє зважування » / «Останні заміри — » — before the last record (separator included). */
  last: string;
  /** «Наступне» / «Наступні» — before the next date. */
  next: string;
  /** «Ще немає зважувань» / «Ще немає замірів». */
  none: string;
}

const WEIGH_COPY: ScheduleCopy = {
  title: 'Вага',
  action: 'зважування',
  last: 'Останнє зважування ',
  next: 'Наступне',
  none: 'Ще немає зважувань',
};

const MEASURE_COPY: ScheduleCopy = {
  title: 'Заміри',
  action: 'заміри',
  last: 'Останні заміри — ',
  next: 'Наступні',
  none: 'Ще немає замірів',
};

/**
 * One weekly row. `lastText` is the latest record («12 жовтня — 65,4 кг», `null` = none yet), `todayText`
 * today's record («65,0 кг»). Until the first-run setup is done, due / overdue are shown as plain upcoming.
 */
function buildSchedule(
  copy: ScheduleCopy,
  reminder: WeeklyReminder,
  check: WeeklyCheck,
  onboarded: boolean,
  lastText: string | null,
  todayText: string | null,
): HomeScheduleRow {
  const state = !onboarded && (check.state === 'due' || check.state === 'overdue') ? 'upcoming' : check.state;
  const { next } = check;
  const nextView: HomeScheduleRow['next'] =
    state === 'due'
      ? { kind: 'due', text: 'Сьогодні' }
      : next.date === null
        ? { kind: 'off', text: next.label }
        : { kind: 'date', text: next.label };
  const nextSentence = next.date === null ? 'Нагадування вимкнено' : `${copy.next}: ${next.text}`;
  const lastSentence = lastText !== null ? `${copy.last}${lastText}` : copy.none;

  if (state === 'done' && todayText !== null) {
    return {
      sub: `Сьогодні — ${todayText}`,
      prefix: { text: '✓ ', tone: 'acc2' },
      next: nextView,
      label: `${copy.title}: сьогодні — ${todayText}. ${nextSentence}`,
    };
  }
  const sub = lastText ?? copy.none;
  if (state === 'due') {
    return {
      sub,
      prefix: null,
      next: nextView,
      label: `${copy.title}: ${copy.action} сьогодні о ${reminder.time}. ${lastSentence}`,
    };
  }
  if (state === 'overdue' && check.missed !== null) {
    return {
      sub,
      prefix: { text: 'Пропущено · ', tone: 'acc' },
      next: nextView,
      label: `${copy.title}: пропущено ${copy.action} ${dLong(check.missed)}. ${lastSentence}. ${nextSentence}`,
    };
  }
  return {
    sub,
    prefix: null,
    next: nextView,
    label: `${copy.title}: ${lowerFirst(lastSentence)}. ${nextSentence}`,
  };
}

function buildWeight(data: AppData, today: ISODate): HomeScheduleRow {
  const last = weightSummary(data).last;
  const todays = data.weights.find((w) => w.date === today);
  return buildSchedule(
    WEIGH_COPY,
    data.settings.rem.weigh,
    weighCheck(data, today),
    data.settings.onboarded,
    last ? `${dLong(last.date)} — ${f1(last.kg)} кг` : null,
    todays ? `${f1(todays.kg)} кг` : null,
  );
}

/** «Груди 90 · Талія 70 · Стегна 98» — only the parameters that have a value; `null` when none. */
function measureValues(values: readonly { key: MeasureKey; value: number | null }[]): string | null {
  const parts = values.filter((p) => p.value !== null).map((p) => `${MEASURE_LABELS[p.key]} ${fN(p.value)}`);
  return parts.length ? parts.join(' · ') : null;
}

function buildMeasure(data: AppData, today: ISODate): HomeScheduleRow {
  const latest = measureValues(measureSummary(data).params.map((p) => ({ key: p.key, value: p.last })));
  const todays: MeasureEntry | undefined = data.measures.find((m) => m.date === today);
  const todayValues = todays
    ? measureValues(MEASURE_PARAMS.map(({ key }) => ({ key, value: todays[key] })))
    : null;
  return buildSchedule(
    MEASURE_COPY,
    data.settings.rem.measure,
    measureCheck(data, today),
    data.settings.onboarded,
    latest,
    todayValues,
  );
}

function buildWeek(data: AppData, today: ISODate): HomeWeek {
  const wk = weekSummary(data, today);
  const t = wk.trainings;
  const p = wk.plannedPerWeek;
  const kcal = wk.avgKcal !== null ? f0(wk.avgKcal) : null;
  // Each half is glued with U+00A0, so a value too wide for the row breaks only after « · » («2 з 3 трен. ·» /
  // «сер. 1 795 ккал») and never leaves «ккал» or «трен.» alone on a line.
  const trainingsPart = p > 0 ? `${t}${NB}з${NB}${p}${NB}трен.` : `${t}${NB}трен.`;
  const text = `${trainingsPart}${kcal !== null ? ` · сер.${NB}${kcal}${NB}ккал` : ''}`;
  const trainings = p > 0 ? `${t} з ${p} ${ofTrainingsWord(p)}` : `${t} ${trainingsWord(t)}`;
  const label = `Тиждень: ${trainings}${kcal !== null ? `, середня калорійність ${kcal} ккал` : ''}. Відкрити прогрес`;
  return { text, label, href: WEEK_HREF };
}

export function buildHomeModel(data: AppData, today: ISODate, opts: HomeModelOptions): HomeModel {
  return {
    todayLabel: dWeekdayLong(today),
    greeting: greeting(opts.now),
    offline: !opts.online,
    banner: buildBanner(data, opts.showInstallHint),
    hero: buildHero(data),
    rows: {
      food: buildFood(data, today),
      workout: buildWorkout(data, today),
      weight: buildWeight(data, today),
      measure: buildMeasure(data, today),
    },
    week: buildWeek(data, today),
  };
}
