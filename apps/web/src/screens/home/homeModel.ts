/**
 * Home «Головна» view model: a pure port of the prototype's `renderVals` home values
 * (todayLabel, greeting, banners, hero, today card, week tiles, measurements, control rows).
 * Everything is formatted here, so the components only lay the strings out.
 */
import {
  dLong,
  dWeekdayLong,
  f0,
  f1,
  fN,
  MINUS,
  ok,
  sgn,
  type AppData,
  type DayEntry,
  type ISODate,
  type MeasureKey,
  type ReminderKind,
} from '@legko/shared';
import {
  changeTone,
  dueReminders,
  measureSummary,
  nextMeasurements,
  nextWeighIn,
  weekSummary,
  weightSummary,
  type ChangeTone,
} from '@/lib/stats';
import { greeting } from '@/lib/useToday';
import type { SheetMode, SheetPatch } from '@/store/ui';

/** Which sheet a button opens for today. */
export interface HomeAction {
  mode: SheetMode;
  patch?: SheetPatch;
}

export type HomeBannerId = 'setup' | ReminderKind | 'install';

export interface HomeBanner {
  id: HomeBannerId;
  title: string;
  sub: string;
  cta: string;
  action: HomeAction;
  /** Has a «Сховати» button (the install hint). */
  dismissible: boolean;
}

export interface HomeHero {
  /** Latest weigh-in, «65,4» | «—». */
  current: string;
  /** Solid badge text: signed change since the start, «−3,0 кг» | «— кг». */
  badge: string;
  /** Progress bar width, 0–100. */
  pct: number;
  /** «45%» */
  pctLabel: string;
  /** Start weight, «68,4» | «—». */
  start: string;
  /** Goal weight, «60,0». */
  goal: string;
  /** «Втрачено» tile, «3,0 кг» | «— кг» (a gain shows as «−0,4 кг»). */
  lost: string;
  /** «До цілі» tile, «5,4 кг» | «— кг». */
  left: string;
}

export interface HomeToday {
  /** «Записано» | «Не записано» */
  food: string;
  /** «1 650 ккал» | «—» */
  kcal: string;
  trained: boolean | null;
  /** Types joined, «Було», «Не було» or «ще не відмічено». */
  training: string;
}

export interface HomeStat {
  id: 'trainings' | 'kcal' | 'weight' | 'waist';
  label: string;
  value: string;
  /** Muted suffix («з 3», «ккал»); omitted when there is nothing to add. */
  unit?: string;
  tone: ChangeTone;
}

export interface HomeMeasureTile {
  key: MeasureKey;
  label: string;
  /** Latest value, «70,5» | «—». */
  value: string;
  /** Change since the first value, «−4 см» | «—». */
  delta: string;
  /** `false` when `delta` is the «—» placeholder (shown faint instead of mint). */
  hasDelta: boolean;
}

export interface HomeMeasures {
  /** Date of the latest measurements, «6 жовтня», or «ще немає». */
  date: string;
  tiles: HomeMeasureTile[];
}

export interface HomeControlRow {
  label: string;
  value: string;
}

export interface HomeModel {
  /** «Субота, 10 жовтня» */
  todayLabel: string;
  /** «Доброго ранку» */
  greeting: string;
  /** Show the «Офлайн» note under the header. */
  offline: boolean;
  banners: HomeBanner[];
  hero: HomeHero;
  today: HomeToday;
  week: HomeStat[];
  measures: HomeMeasures;
  control: HomeControlRow[];
}

export interface HomeModelOptions {
  /** Current time, for the greeting. */
  now: Date;
  online: boolean;
  /** iPhone in Safari and the hint was not dismissed. */
  showInstallHint: boolean;
}

export interface QuickActionModel {
  label: string;
  tone: 'acc' | 'acc2' | 'neutral';
  action: HomeAction;
}

/** The four «+ Додати …» buttons. */
export const QUICK_ACTIONS: readonly QuickActionModel[] = [
  { label: 'Харчування', tone: 'acc2', action: { mode: 'day' } },
  { label: 'Тренування', tone: 'acc', action: { mode: 'day', patch: { trained: true } } },
  { label: 'Вага', tone: 'neutral', action: { mode: 'weight' } },
  { label: 'Заміри', tone: 'neutral', action: { mode: 'measure' } },
];

export const NO_TRAINING_TOAST = 'Відмічено: без тренування';
export const OFFLINE_NOTE = 'Офлайн · зміни збережено на телефоні';

const DASH = '—';
const EMPTY_DAY: DayEntry = { food: '', kcal: null, trained: null, types: [], notes: '' };

/** The day after «✕ Не було»: no workout, everything else (food, kcal, notes, photos) kept. */
export function markNoTraining(entry: DayEntry | undefined): DayEntry {
  return { ...EMPTY_DAY, ...entry, trained: false, types: [] };
}

/** Like `f`, but a negative value gets the typographic minus (and no «+» for positives). */
function minusOnly(n: number, f: (x: number) => string): string {
  const text = f(Math.abs(n));
  return n < 0 && /[1-9]/.test(text) ? MINUS + text : text;
}

function buildBanners(data: AppData, today: ISODate, showInstallHint: boolean): HomeBanner[] {
  const { rem, onboarded } = data.settings;
  const banners: HomeBanner[] = [];
  if (!onboarded) {
    banners.push({
      id: 'setup',
      title: 'Почнімо',
      sub: 'Запиши стартову вагу й ціль — прогрес рахуватиметься сам',
      cta: 'Налаштувати',
      action: { mode: 'setup' },
      dismissible: false,
    });
  }
  for (const kind of onboarded ? dueReminders(data, today) : []) {
    if (kind === 'weigh') {
      banners.push({
        id: kind,
        title: 'Контрольне зважування',
        sub: `Сьогодні о ${rem.weigh.time}`,
        cta: 'Записати',
        action: { mode: 'weight' },
        dismissible: false,
      });
    } else if (kind === 'measure') {
      banners.push({
        id: kind,
        title: 'Заміри тіла',
        sub: `Сьогодні о ${rem.measure.time}`,
        cta: 'Записати',
        action: { mode: 'measure' },
        dismissible: false,
      });
    } else {
      banners.push({
        id: kind,
        title: 'Тренування за планом',
        sub: `Сьогодні о ${rem.workout.time} — відміть, як пройде`,
        cta: 'Відмітити',
        action: { mode: 'day', patch: { trained: true } },
        dismissible: false,
      });
    }
  }
  if (showInstallHint) {
    banners.push({
      id: 'install',
      title: 'Встанови Легко на iPhone',
      sub: 'Так працюватимуть нагадування',
      cta: 'Як?',
      action: { mode: 'install' },
      dismissible: true,
    });
  }
  return banners;
}

function buildHero(data: AppData): HomeHero {
  const w = weightSummary(data);
  return {
    current: w.last ? f1(w.last.kg) : DASH,
    badge: `${w.lost !== null ? sgn(-w.lost, f1) : DASH} кг`,
    pct: w.pct,
    pctLabel: `${Math.round(w.pct)}%`,
    start: w.first ? f1(w.first.kg) : DASH,
    goal: f1(w.goal),
    lost: `${w.lost !== null ? minusOnly(w.lost, f1) : DASH} кг`,
    left: `${w.left !== null ? f1(w.left) : DASH} кг`,
  };
}

function trainingLabel(entry: DayEntry | undefined): string {
  if (entry?.trained === true) return entry.types.join(', ') || 'Було';
  if (entry?.trained === false) return 'Не було';
  return 'ще не відмічено';
}

function buildToday(data: AppData, today: ISODate): HomeToday {
  const entry = data.days[today];
  const hasFood = !!entry && (entry.food.trim() !== '' || (entry.photos?.length ?? 0) > 0);
  return {
    food: hasFood ? 'Записано' : 'Не записано',
    kcal: entry && ok(entry.kcal) ? `${f0(entry.kcal)} ккал` : DASH,
    trained: entry?.trained ?? null,
    training: trainingLabel(entry),
  };
}

function buildWeek(data: AppData, today: ISODate): HomeStat[] {
  const wk = weekSummary(data, today);
  return [
    {
      id: 'trainings',
      label: 'Тренувань',
      value: String(wk.trainings),
      unit: wk.plannedPerWeek > 0 ? `з ${wk.plannedPerWeek}` : undefined,
      tone: 'flat',
    },
    { id: 'kcal', label: 'Сер. калорії', value: f0(wk.avgKcal), unit: 'ккал', tone: 'flat' },
    {
      id: 'weight',
      label: 'Зміна ваги',
      value: sgn(wk.weightChange, f1),
      unit: 'кг',
      tone: changeTone(wk.weightChange),
    },
    { id: 'waist', label: 'Талія', value: sgn(wk.waistChange), unit: 'см', tone: changeTone(wk.waistChange) },
  ];
}

function buildMeasures(data: AppData): HomeMeasures {
  const m = measureSummary(data);
  return {
    date: m.lastEntry ? dLong(m.lastEntry.date) : 'ще немає',
    tiles: m.params.map((p) => ({
      key: p.key,
      label: p.label,
      value: fN(p.last),
      delta: p.delta !== null ? `${sgn(p.delta)} см` : DASH,
      hasDelta: p.delta !== null,
    })),
  };
}

function buildControl(data: AppData, today: ISODate): HomeControlRow[] {
  const last = weightSummary(data).last;
  return [
    { label: 'Останнє зважування', value: last ? `${dLong(last.date)} — ${f1(last.kg)} кг` : DASH },
    { label: 'Наступне зважування', value: nextWeighIn(data, today).text },
    { label: 'Наступні заміри', value: nextMeasurements(data, today).text },
  ];
}

export function buildHomeModel(data: AppData, today: ISODate, opts: HomeModelOptions): HomeModel {
  return {
    todayLabel: dWeekdayLong(today),
    greeting: greeting(opts.now),
    offline: !opts.online,
    banners: buildBanners(data, today, opts.showInstallHint),
    hero: buildHero(data),
    today: buildToday(data, today),
    week: buildWeek(data, today),
    measures: buildMeasures(data),
    control: buildControl(data, today),
  };
}
