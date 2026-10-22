import { coachSummary, type AttentionFlag } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { dayTime, dayWord, longDate } from '../settings/dates';
import { client, item, NOW, overKcal } from './coach.fixtures';
import {
  allChip,
  attentionChip,
  COACH_COPY,
  columnLabels,
  countLine,
  flagDetail,
  flagPill,
  goalsLine,
  headerSubtitle,
  KPI,
  nobodyFound,
  periodLabel,
  phoneSub,
  scheduleLine,
  shownCount,
  sortOptionLabel,
  statusPill,
  stepsGoalSuffix,
  stepsLong,
  TAB_LABELS,
  tableCaption,
  tableNote,
  loggedText,
  workoutsText,
} from './copy';

const NB = ' ';
const DAY = 86_400_000;

describe('coach copy (docs/coach-cabinet.md §7.2)', () => {
  it('uses the Ukrainian apostrophe ʼ (U+02BC) and never a typewriter or curly one', () => {
    const all = JSON.stringify(COACH_COPY);
    expect(all).not.toMatch(/['’]/);
    expect(COACH_COPY.searchLabel).toBe('Пошук за імʼям');
    expect(COACH_COPY.searchPlaceholder).toBe('Імʼя');
    expect(COACH_COPY.newClientText).toBe('Записи зʼявляться тут, щойно людина почне вести щоденник.');
    expect(sortOptionLabel('name')).toBe('Імʼя');
  });

  it('has the fixed strings verbatim', () => {
    expect(COACH_COPY).toMatchObject({
      title: 'Клієнти',
      filtersLabel: 'Показати',
      periodLabel: 'Період',
      sortLabel: 'Сортування',
      readOnly: 'Лише перегляд',
      tabsLabel: 'Розділи клієнта',
      now: 'Зараз',
      checkTitle: 'Що варто перевірити',
      noFlags: 'Тривожних сигналів немає',
      disabledFlags: 'Акаунт вимкнено — сигнали не рахуються',
      newClientTitle: 'Ще нічого не записано',
      meals: 'Прийоми їжі',
      emptyDay: 'Цього дня нічого не записано',
      kcalByDay: 'Калорії по днях',
      daysWithKcal: 'Днів із калоріями',
      macrosByDay: 'Б · Ж · В по днях',
      partialFootnote: '* — пораховано не для всіх прийомів',
      journal: 'Журнал харчування',
      showMore: 'Показати ще',
      openDay: 'Відкрити день →',
      noKcal: 'За цей період калорій ще немає',
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
      neverSeen: 'Ще не входили',
      noRecordsEver: 'Жодного запису від реєстрації',
      newClient: 'Новий клієнт',
      noSchedule: 'Розкладу немає',
      noSessions: 'За цей період тренувань не записано',
      skipped: 'Пропущено',
      record: 'рекорд',
    });
    expect(TAB_LABELS).toEqual({
      overview: 'Огляд',
      progress: 'Прогрес',
      calendar: 'Календар',
      nutrition: 'Харчування',
      workouts: 'Тренування',
    });
    expect(KPI.steps).toBe('Кроки, сер.');
    expect([periodLabel(7), periodLabel(30)]).toEqual(['7 днів', '30 днів']);
    expect(nobodyFound('ол')).toBe('Нікого не знайдено за «ол»');
    expect(shownCount(2, 5)).toBe('Показано 2 з 5');
    expect([attentionChip(4), allChip(6)]).toEqual(['Потребують уваги · 4', 'Усі · 6']);
  });

  it('counts clients and those who need attention (the second part only when someone does)', () => {
    expect(countLine(6, 4)).toBe('6 клієнтів · 4 потребують уваги');
    expect(countLine(1, 1)).toBe('1 клієнт · 1 потребує уваги');
    expect(countLine(3, 0)).toBe('3 клієнти');
    expect(countLine(22, 2)).toBe('22 клієнти · 2 потребують уваги');
    expect(countLine(11, 0)).toBe('11 клієнтів');
  });

  it('names the 9 columns for both periods', () => {
    const week = columnLabels(7);
    expect(Object.values(week).map((c) => c.label)).toEqual([
      'Клієнт',
      'Вага, кг',
      'За тиждень',
      'До цілі',
      'Ккал · 7 дн.',
      'Тренування',
      'Кроки',
      'Записи · 7 дн.',
      'Активність',
    ]);
    expect(week.kcal.sub).toBe('Б · Ж · В, г');
    expect(week.workouts.title).toBe('за тиждень');
    expect(week.steps).toEqual({ label: 'Кроки', title: 'середнє за день' });
    const month = columnLabels(30);
    expect([month.change.label, month.kcal.label, month.logged.label, month.workouts.title]).toEqual([
      'За 30 днів',
      'Ккал · 30 дн.',
      'Записи · 30 дн.',
      'за 30 днів',
    ]);
    expect(tableCaption(7)).toBe('Клієнти · за 7 днів');
  });

  it('notes the windows under the table (signals are always the last 7 days)', () => {
    expect(tableNote(7)).toBe(
      'Калорії, Б · Ж · В, кроки і записи — за повні дні до сьогодні; тренування — з понеділка; сигнали — за останні 7 днів.',
    );
    expect(tableNote(30)).toBe(
      'Калорії, Б · Ж · В, кроки і записи — за повні дні до сьогодні; тренування — за 30 днів; сигнали — за останні 7 днів.',
    );
  });

  it('writes the steps average, its goal and the long form for screen readers', () => {
    expect(stepsGoalSuffix(10_000)).toBe(` / 10${NB}000`);
    expect(stepsGoalSuffix(null)).toBe('');
    expect(stepsLong(7850, 10_000, 7)).toBe(`кроків у середньому 7${NB}850 на день за 7 днів, ціль 10${NB}000`);
    expect(stepsLong(7850, null, 30)).toBe(`кроків у середньому 7${NB}850 на день за 30 днів`);
    expect(stepsLong(null, 10_000, 7)).toBe('кроки: за 7 днів не записано');
  });

  it('writes the schedule by the first weekday (Mon … Sun), leaving out workouts without days', () => {
    expect(
      scheduleLine([
        { name: 'Верх тіла', days: [5] },
        { name: 'Розтяжка', days: [] },
        { name: 'Ноги + прес', days: [3, 1] },
        { name: 'Прогулянка', days: [0, 6] },
      ]),
    ).toBe('Розклад: Пн, Ср — Ноги + прес · Пт — Верх тіла · Сб, Нд — Прогулянка');
    expect(scheduleLine([{ name: 'Розтяжка', days: [] }])).toBe('Розкладу немає');
    expect(scheduleLine([])).toBe('Розкладу немає');
  });

  it('offers short phone sort options (they share a row with the 7 / 30 switch)', () => {
    const keys = [
      'attention',
      'name',
      'weight',
      'change',
      'goalPct',
      'kcal',
      'workouts',
      'steps',
      'logged',
      'activity',
    ] as const;
    const labels = keys.map((k) => sortOptionLabel(k));
    expect(labels).toEqual([
      'За увагою',
      'Імʼя',
      'Вага',
      'Зміна ваги',
      'До цілі',
      'Калорії',
      'Тренування',
      'Кроки',
      'Записи',
      'Активність',
    ]);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(10);
  });

  it('writes counts with a slash, never «з» between digits (Manrope draws «З»/«з» like «3»)', () => {
    expect(workoutsText(1, 3)).toBe(`1${NB}/${NB}3`);
    expect(workoutsText(2, 0)).toBe('2');
    expect(loggedText(6, 7)).toBe(`6${NB}/${NB}7`);
    expect(loggedText(12, 30)).toBe(`12${NB}/${NB}30`);
    for (const text of [workoutsText(1, 3), loggedText(7, 7)]) expect(text).not.toMatch(/\d\s*з\s*\d/);
  });

  it('writes the phone row sub for both periods', () => {
    const seen = NOW.getTime() - 3_600_000;
    expect(
      phoneSub({
        period: 7,
        change: '−0,4',
        kcal: { avg: `1${NB}950`, goal: `1${NB}700` },
        logged: { days: 6, of: 7 },
        lastSeenAt: seen,
        now: NOW,
      }),
    ).toBe(`−0,4 за тиждень · 1${NB}950 / 1${NB}700 ккал · активність сьогодні`);
    expect(
      phoneSub({ period: 30, change: '−1,2', kcal: null, logged: { days: 12, of: 30 }, lastSeenAt: seen, now: NOW }),
    ).toBe(`−1,2 за 30 днів · Записи 12${NB}/${NB}30 · активність сьогодні`);
    expect(
      phoneSub({ period: 7, change: null, kcal: null, logged: { days: 1, of: 7 }, lastSeenAt: null, now: NOW }),
    ).toBe(`Записи 1${NB}/${NB}7 · ще не входили`);
    // The row carries the «Ще не входили» pill: the line does not say it again.
    expect(
      phoneSub({
        period: 7,
        change: null,
        kcal: null,
        logged: { days: 0, of: 7 },
        lastSeenAt: null,
        now: NOW,
        omitNeverSeen: true,
      }),
    ).toBe(`Записи 0${NB}/${NB}7`);
  });

  describe('pills', () => {
    const pill = (flag: AttentionFlag) => flagPill(flag);

    it('kcal_over says «за 7 днів» in both periods (the rule always looks at 7 full days)', () => {
      const it7 = coachSummary(item(client(1, 'olya'), overKcal()), NOW, 7);
      const it30 = coachSummary(item(client(1, 'olya'), overKcal()), NOW, 30);
      const kcal7 = it7.flags.find((f) => f.kind === 'kcal_over');
      const kcal30 = it30.flags.find((f) => f.kind === 'kcal_over');
      expect(kcal7 && pill(kcal7)).toBe('Калорії +15% за 7 днів');
      expect(kcal30 && pill(kcal30)).toBe('Калорії +15% за 7 днів');
    });

    it('words the other flags and statuses', () => {
      expect(pill({ kind: 'inactive', days: 8, never: false })).toBe('Не заходить 8 днів');
      expect(pill({ kind: 'inactive', days: 22, never: false })).toBe('Не заходить 22 дні');
      expect(pill({ kind: 'inactive', days: 21, never: false })).toBe('Не заходить 21 день');
      expect(pill({ kind: 'inactive', days: 10, never: true })).toBe('Ще не входили');
      expect(pill({ kind: 'no_records', days: 4, last: '2026-10-09' })).toBe('4 дні без записів');
      expect(pill({ kind: 'no_records', days: 5, last: '2026-10-08' })).toBe('5 днів без записів');
      // Its own words: never the neutral «Новий клієнт», never the overview card title «Ще нічого не записано».
      expect(pill({ kind: 'no_records', days: null, last: null })).toBe('Жодного запису від реєстрації');
      expect(pill({ kind: 'no_records', days: null, last: null })).not.toBe(COACH_COPY.newClient);
      expect(pill({ kind: 'no_records', days: null, last: null })).not.toBe(COACH_COPY.newClientTitle);
      expect(pill({ kind: 'no_weigh_in', missed: '2026-10-12', last: null, days: null })).toBe('Без зважування');
      expect(statusPill('disabled')).toBe('Вимкнено');
      expect(statusPill('pending')).toBe('Пароль не задано');
      expect(statusPill('active')).toBeNull();
    });
  });

  describe('flag details', () => {
    it('inactive: the last activity, or never since registration', () => {
      const seen = NOW.getTime() - 9 * DAY;
      expect(flagDetail({ kind: 'inactive', days: 9, never: false }, NOW, seen)).toBe(
        `Остання активність — ${dayWord(seen, NOW.getTime())}`,
      );
      expect(flagDetail({ kind: 'inactive', days: 9, never: false }, NOW)).toBe(
        `Остання активність — ${dayWord(seen, NOW.getTime())}`,
      );
      expect(flagDetail({ kind: 'inactive', days: 10, never: true }, NOW)).toBe('Після реєстрації ще не входили');
    });

    it('no_records: the last record, or none since registration', () => {
      expect(flagDetail({ kind: 'no_records', days: 4, last: '2026-10-09' }, NOW)).toBe('Останній запис — 9 жовтня');
      expect(flagDetail({ kind: 'no_records', days: null, last: null }, NOW)).toBe('Від реєстрації — жодного запису');
    });

    it('no_weigh_in: the planned day (reminder on) or the last weigh-in (reminder off)', () => {
      expect(flagDetail({ kind: 'no_weigh_in', missed: '2026-10-12', last: '2026-10-05', days: null }, NOW)).toBe(
        'Зважування за планом — Пн, 12 жовтня · останнє 5 жовтня',
      );
      expect(flagDetail({ kind: 'no_weigh_in', missed: '2026-10-12', last: null, days: null }, NOW)).toBe(
        'Зважування за планом — Пн, 12 жовтня · зважувань ще не було',
      );
      expect(flagDetail({ kind: 'no_weigh_in', missed: null, last: '2026-10-02', days: 12 }, NOW)).toBe(
        'Останнє зважування — 2 жовтня',
      );
      expect(flagDetail({ kind: 'no_weigh_in', missed: null, last: null, days: null }, NOW)).toBe(
        'Ще жодного зважування',
      );
    });

    it('kcal_over: the average and the goal', () => {
      expect(flagDetail({ kind: 'kcal_over', avg: 1950, goal: 1700, overPct: 15, days: 7 }, NOW)).toBe(
        `Середнє за 7 днів — 1${NB}950 ккал при цілі 1${NB}700`,
      );
      expect(flagDetail({ kind: 'kcal_over', avg: 2100, goal: 1700, overPct: 24, days: 3 }, NOW)).toBe(
        `Середнє за 3 дні — 2${NB}100 ккал при цілі 1${NB}700`,
      );
    });
  });

  describe('client header', () => {
    it('says since when and the last activity, or that they never signed in', () => {
      const c = client(1, 'olya', { lastSeenAt: NOW.getTime() - 3_600_000 });
      expect(headerSubtitle(c, NOW)).toBe(
        `У Home Fit з ${longDate(c.createdAt)} · активність: ${dayTime(c.lastSeenAt ?? 0, NOW.getTime())}`,
      );
      expect(headerSubtitle({ ...c, lastSeenAt: null }, NOW)).toBe(
        `У Home Fit з ${longDate(c.createdAt)} · ще не входили`,
      );
      // The «Ще не входили» pill is in the header: the line leaves it out.
      expect(headerSubtitle({ ...c, lastSeenAt: null }, NOW, true)).toBe(`У Home Fit з ${longDate(c.createdAt)}`);
      expect(headerSubtitle(c, NOW, true)).toContain('· активність: ');
    });

    it('never starts with «З» followed by a digit (it would read as «3 4 вересня»)', () => {
      const c = client(1, 'olya', { lastSeenAt: NOW.getTime() - 3_600_000 });
      for (const line of [headerSubtitle(c, NOW), headerSubtitle({ ...c, lastSeenAt: null }, NOW)])
        expect(line).not.toMatch(/^З\s*\d/);
    });

    const settings = (protein: number | null, fat: number | null, carbs: number | null, plan: number[]) => ({
      goal: 60,
      kcalGoal: 1700,
      macroGoals: { protein, fat, carbs },
      rem: {
        workout: { on: true, days: plan as never, time: '18:00' },
        weigh: { on: true, day: 1 as never, time: '08:00' },
        measure: { on: true, day: 0 as never, time: '09:00' },
      },
    });

    it('lists only the macro goals that are set, each with «г», and the weekly plan', () => {
      expect(goalsLine(settings(null, null, null, [1, 3, 5]))).toBe(
        `Ціль 60,0 кг · 1${NB}700 ккал на день · 3 тренування на тиждень`,
      );
      expect(goalsLine(settings(90, null, null, [1, 3, 5]))).toBe(
        `Ціль 60,0 кг · 1${NB}700 ккал на день · Б 90 г · 3 тренування на тиждень`,
      );
      expect(goalsLine(settings(90, 60, null, [1, 3, 5]))).toBe(
        `Ціль 60,0 кг · 1${NB}700 ккал на день · Б 90 г · Ж 60 г · 3 тренування на тиждень`,
      );
      expect(goalsLine(settings(null, null, 200, [1, 2, 3, 4, 5]))).toBe(
        `Ціль 60,0 кг · 1${NB}700 ккал на день · В 200 г · 5 тренувань на тиждень`,
      );
      expect(goalsLine(settings(null, null, null, []))).toBe(`Ціль 60,0 кг · 1${NB}700 ккал на день`);
    });
  });

  it('labels the «Огляд» numbers', () => {
    expect([KPI.weight, KPI.sinceStart, KPI.goalPct, KPI.kcal(1700), KPI.macros, KPI.workouts, KPI.logged]).toEqual([
      'Вага',
      'Від старту',
      'До цілі',
      `Ккал · ціль 1${NB}700`,
      'Б · Ж · В',
      'Тренування',
      'Записи',
    ]);
  });
});
