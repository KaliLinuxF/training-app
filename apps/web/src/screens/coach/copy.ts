/**
 * Every Ukrainian string of «Клієнти» (docs/coach-cabinet.md §7.2). Apostrophes are always «ʼ» (U+02BC), as in the
 * rest of the app. Numbers come in already formatted only where a helper below says so.
 */
import {
  dLong,
  DOW_SHORT,
  f0,
  f1,
  parse,
  type AttentionFlag,
  type CoachClient,
  type CoachClientStatus,
  type CoachPeriod,
  type MacroGoals,
  type Settings,
} from '@legko/shared';
import { dayTime, dayWord, longDate } from '../settings/dates';
import { plural } from '../settings/model';

export const COACH_COPY = {
  title: 'Клієнти',
  /** Heading of a client page while it loads or failed (the name is not known yet). */
  clientFallback: 'Клієнт',
  backLabel: 'Клієнти',

  searchLabel: 'Пошук за імʼям',
  searchPlaceholder: 'Імʼя',
  filtersLabel: 'Показати',
  periodLabel: 'Період',
  sortLabel: 'Сортування',

  readOnly: 'Лише перегляд',
  tabsLabel: 'Розділи клієнта',

  // overview
  now: 'Зараз',
  checkTitle: 'Що варто перевірити',
  noFlags: 'Тривожних сигналів немає',
  disabledFlags: 'Акаунт вимкнено — сигнали не рахуються',
  newClientTitle: 'Ще нічого не записано',
  newClientText: 'Записи зʼявляться тут, щойно людина почне вести щоденник.',

  // day view
  meals: 'Прийоми їжі',
  training: 'Тренування',
  weight: 'Вага',
  measures: 'Заміри',
  notes: 'Нотатки',
  emptyDay: 'Цього дня нічого не записано',

  // nutrition
  kcalByDay: 'Калорії по днях',
  withinGoal: 'У межах цілі',
  overGoal: 'Більше цілі',
  daysWithKcal: 'Днів із калоріями',
  macrosByDay: 'Б · Ж · В по днях',
  day: 'День',
  kcal: 'Ккал',
  protein: 'Білки',
  fat: 'Жири',
  carbs: 'Вуглеводи',
  partialFootnote: '* — пораховано не для всіх прийомів',
  partialHidden: 'пораховано не для всіх прийомів',
  journal: 'Журнал харчування',
  showMore: 'Показати ще',
  openDay: 'Відкрити день →',
  noKcal: 'За цей період калорій ще немає',

  // states
  loading: 'Завантажую…',
  loadFailed: 'Не вдалося завантажити',
  retry: 'Спробувати ще раз',
  offline: 'Потрібен інтернет',
  notFound: 'Клієнта не знайдено',
  notFoundText: 'Можливо, акаунт видалили або він став адміністратором.',
  noClients: 'Клієнтів ще немає',
  noClientsText: 'Запроси людину в розділі «Користувачі».',
  openUsers: 'Відкрити «Користувачі»',
  noneNeedAttention: 'Зараз ніхто не потребує уваги',

  // pills
  neverSeen: 'Ще не входили',
  /** The no_records flag of an account that has never recorded anything (lavender). */
  noRecordsEver: 'Жодного запису від реєстрації',
  /** Neutral: an active account with nothing recorded yet and nothing to worry about (younger than 3 days). */
  newClient: 'Новий клієнт',
  noWeighIn: 'Без зважування',
  statusDisabled: 'Вимкнено',
  statusPending: 'Пароль не задано',
} as const;

export type CoachTab = 'overview' | 'progress' | 'calendar' | 'nutrition';

export const TAB_LABELS: Readonly<Record<CoachTab, string>> = {
  overview: 'Огляд',
  progress: 'Прогрес',
  calendar: 'Календар',
  nutrition: 'Харчування',
};

/** «7 днів» · «30 днів» (the period switch). */
export const periodLabel = (p: CoachPeriod): string => `${p} днів`;

/** «за тиждень» (Monday … today) for 7, «за 30 днів» for 30: weight change and workouts. */
export const rangeWords = (p: CoachPeriod): string => (p === 7 ? 'за тиждень' : 'за 30 днів');

/** «За тиждень» / «За 30 днів» (column header, KPI label). */
export const rangeTitle = (p: CoachPeriod): string => (p === 7 ? 'За тиждень' : 'За 30 днів');

/** «6 клієнтів · 4 потребують уваги» (the attention part is left out when nobody needs it). */
export function countLine(n: number, attention: number): string {
  const head = `${n} ${plural(n, 'клієнт', 'клієнти', 'клієнтів')}`;
  if (attention === 0) return head;
  return `${head} · ${attention} ${attention === 1 ? 'потребує' : 'потребують'} уваги`;
}

export const attentionChip = (n: number): string => `Потребують уваги · ${n}`;
export const allChip = (n: number): string => `Усі · ${n}`;
export const shownCount = (n: number, total: number): string => `Показано ${n} з ${total}`;
export const nobodyFound = (q: string): string => `Нікого не знайдено за «${q}»`;

/**
 * The sort options of the phone list (`'attention'` = the default order). Short, so the select fits next to the
 * 7 / 30 switch at 320px (the period is right beside it).
 */
export function sortOptionLabel(key: 'attention' | SortKeyCopy): string {
  switch (key) {
    case 'attention':
      return 'За увагою';
    case 'name':
      return 'Імʼя';
    case 'weight':
      return 'Вага';
    case 'change':
      return 'Зміна ваги';
    case 'goalPct':
      return 'До цілі';
    case 'kcal':
      return 'Калорії';
    case 'workouts':
      return 'Тренування';
    case 'logged':
      return 'Записи';
    case 'activity':
      return 'Активність';
  }
}

/** Mirrors `SortKey` of the clients model (kept here so the copy has no model import). */
type SortKeyCopy = 'name' | 'weight' | 'change' | 'goalPct' | 'kcal' | 'workouts' | 'logged' | 'activity';

/** Column headers of the desktop table (8 columns); `sub` is a second header line. */
export function columnLabels(p: CoachPeriod): Readonly<Record<SortKeyCopy, { label: string; sub?: string; title?: string }>> {
  return {
    name: { label: 'Клієнт' },
    weight: { label: 'Вага, кг' },
    change: { label: rangeTitle(p) },
    goalPct: { label: 'До цілі' },
    kcal: { label: `Ккал · ${p} дн.`, sub: 'Б · Ж · В, г' },
    workouts: { label: 'Тренування', title: rangeWords(p) },
    logged: { label: `Записи · ${p} дн.` },
    activity: { label: 'Активність' },
  };
}

/** Visually hidden caption of the table: «Клієнти · за 7 днів». */
export const tableCaption = (p: CoachPeriod): string => `Клієнти · за ${p} днів`;

/** The note under the table. */
export const tableNote = (p: CoachPeriod): string =>
  `Калорії, Б · Ж · В і записи — за повні дні до сьогодні; тренування — ${
    p === 7 ? 'з понеділка' : 'за 30 днів'
  }; сигнали — за останні 7 днів.`;

/** «−2,9 від старту» (the second line of the weight cell). */
export const sinceStartLine = (signed: string): string => `${signed} від старту`;

/**
 * «a / b» with no-break spaces. In Manrope a lone «з» between digits reads as another «3» («1 з 3» → «1 3 3»), so
 * counts in cells and tiles use a slash; «з» stays inside sentences and the screen-reader forms.
 */
const NBSP = String.fromCharCode(0xa0);
const ratio = (a: number, b: number): string => `${a}${NBSP}/${NBSP}${b}`;

/** «2 / 3», or «2» when there is no plan. */
export const workoutsText = (done: number, planned: number): string =>
  planned > 0 ? ratio(done, planned) : String(done);

/** «6 / 7». */
export const loggedText = (days: number, of: number): string => ratio(days, of);

/** «сьогодні», «вчора», «9 жовтня», or «Ще не входили». */
export const activityText = (lastSeenAt: number | null, now: Date): string =>
  lastSeenAt === null ? COACH_COPY.neverSeen : dayWord(lastSeenAt, now.getTime());

/**
 * Phone list row sub (period-aware, §6.2). `omitNeverSeen`: the row already carries the «Ще не входили» pill, so the
 * line does not repeat it.
 */
export function phoneSub(parts: {
  period: CoachPeriod;
  change: string | null;
  kcal: { avg: string; goal: string } | null;
  logged: { days: number; of: number };
  lastSeenAt: number | null;
  now: Date;
  omitNeverSeen?: boolean;
}): string {
  const out: string[] = [];
  if (parts.change !== null) out.push(`${parts.change} ${rangeWords(parts.period)}`);
  if (parts.kcal) out.push(`${parts.kcal.avg} / ${parts.kcal.goal} ккал`);
  else out.push(`Записи ${loggedText(parts.logged.days, parts.logged.of)}`);
  if (parts.lastSeenAt !== null) out.push(`активність ${dayWord(parts.lastSeenAt, parts.now.getTime())}`);
  else if (!parts.omitNeverSeen) out.push('ще не входили');
  return out.join(' · ');
}

/** The short pill of a flag (both periods: the kcal rule always looks at the last 7 full days). */
export function flagPill(flag: AttentionFlag): string {
  switch (flag.kind) {
    case 'inactive':
      return flag.never ? COACH_COPY.neverSeen : `Не заходить ${flag.days} ${plural(flag.days, 'день', 'дні', 'днів')}`;
    case 'no_records':
      return flag.days === null
        ? COACH_COPY.noRecordsEver
        : `${flag.days} ${plural(flag.days, 'день', 'дні', 'днів')} без записів`;
    case 'no_weigh_in':
      return COACH_COPY.noWeighIn;
    case 'kcal_over':
      return `Калорії +${flag.overPct}% за 7 днів`;
  }
}

/**
 * The longer line under a flag in «Що варто перевірити». `lastSeenAt` (the client's) dates «Остання активність»
 * exactly; without it the flag's whole-day count is used.
 */
export function flagDetail(flag: AttentionFlag, now: Date, lastSeenAt?: number | null): string {
  switch (flag.kind) {
    case 'inactive': {
      if (flag.never) return 'Після реєстрації ще не входили';
      const seen = lastSeenAt ?? now.getTime() - flag.days * 86_400_000;
      return `Остання активність — ${dayWord(seen, now.getTime())}`;
    }
    case 'no_records':
      return flag.last === null ? 'Від реєстрації — жодного запису' : `Останній запис — ${dLong(flag.last)}`;
    case 'no_weigh_in':
      if (flag.missed !== null) {
        const day = DOW_SHORT[parse(flag.missed).getDay()] ?? '';
        const tail = flag.last ? ` · останнє ${dLong(flag.last)}` : ' · зважувань ще не було';
        return `Зважування за планом — ${day}, ${dLong(flag.missed)}${tail}`;
      }
      return flag.last ? `Останнє зважування — ${dLong(flag.last)}` : 'Ще жодного зважування';
    case 'kcal_over':
      return `Середнє за ${flag.days} ${plural(flag.days, 'день', 'дні', 'днів')} — ${f0(flag.avg)} ккал при цілі ${f0(flag.goal)}`;
  }
}

/** Neutral status pill of an account that is not active, else null. */
export function statusPill(status: CoachClientStatus): string | null {
  if (status === 'disabled') return COACH_COPY.statusDisabled;
  if (status === 'pending') return COACH_COPY.statusPending;
  return null;
}

/**
 * «У Легко з 9 жовтня 2026 · активність: сьогодні, 09:12» / «У Легко з 9 жовтня 2026 · ще не входили». The line never
 * starts with «З» + a digit (in Manrope the capital «З» looks like «3»). `omitNeverSeen`: the header already shows the
 * «Ще не входили» pill.
 */
export function headerSubtitle(client: CoachClient, now: Date, omitNeverSeen = false): string {
  const since = `У Легко з ${longDate(client.createdAt)}`;
  if (client.lastSeenAt !== null) return `${since} · активність: ${dayTime(client.lastSeenAt, now.getTime())}`;
  return omitNeverSeen ? since : `${since} · ще не входили`;
}

const MACRO_SHORT: readonly (readonly [keyof MacroGoals, string])[] = [
  ['protein', 'Б'],
  ['fat', 'Ж'],
  ['carbs', 'В'],
];

/**
 * «Ціль 60,0 кг · 1 700 ккал на день · Б 90 г · Ж 60 г · 3 тренування на тиждень»: only the macro goals that are set,
 * and the plan only when it has days.
 */
export function goalsLine(settings: Pick<Settings, 'goal' | 'kcalGoal' | 'macroGoals' | 'rem'>): string {
  let line = `Ціль ${f1(settings.goal)} кг · ${f0(settings.kcalGoal)} ккал на день`;
  for (const [key, short] of MACRO_SHORT) {
    const g = settings.macroGoals[key];
    if (g !== null) line += ` · ${short} ${f0(g)} г`;
  }
  const n = settings.rem.workout.days.length;
  if (n > 0) line += ` · ${n} ${plural(n, 'тренування', 'тренування', 'тренувань')} на тиждень`;
  return line;
}

/** KPI labels of «Огляд». */
export const KPI = {
  weight: 'Вага',
  sinceStart: 'Від старту',
  goalPct: 'До цілі',
  kcal: (goal: number): string => `Ккал · ціль ${f0(goal)}`,
  macros: 'Б · Ж · В',
  workouts: 'Тренування',
  logged: 'Записи',
} as const;

/** «Сер. за 7 повних днів». */
export const avgFullDays = (n: number): string => `Сер. за ${n} повних днів`;
/** «ціль 90» (a macro column header). */
export const goalWord = (g: number): string => `ціль ${f0(g)}`;
