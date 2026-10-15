import {
  DEFAULT_MEAL_TYPES,
  defaultReminders,
  defaultSettings,
  emptyData,
  f0,
  GOAL_LIMITS,
  LIMITS,
  type Settings,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { NBSP } from '@/lib/nutrition';
import {
  addCustomType,
  addMealType,
  errorText,
  goalRows,
  keyTypeRows,
  MACRO_GOAL_ERROR,
  macroGoalText,
  MEAL_TYPE_ERRORS,
  mealTypesNote,
  missingDefaults,
  moveMealType,
  NO_TYPE_ROWS,
  notifView,
  parseBackup,
  parseMacroGoal,
  plural,
  reminderSubtitle,
  removeCustomType,
  removeMealType,
  renameMealType,
  renameTypeRow,
  restoreDefaultMealTypes,
  stepGoal,
  stepValue,
  syncStatus,
  withReminder,
  workoutDaysText,
} from './model';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...patch });

describe('reminder copy', () => {
  it('lists workout days Monday first, like the prototype', () => {
    expect(workoutDaysText([5, 1, 3])).toBe('Пн, Ср, Пт');
    expect(workoutDaysText([0, 6, 1])).toBe('Пн, Сб, Нд');
    expect(workoutDaysText([])).toBe('Дні не вибрані');
  });

  it('builds the card subtitles', () => {
    const rem = defaultReminders();
    expect(reminderSubtitle('workout', rem)).toBe('Пн, Ср, Пт · 18:00');
    expect(reminderSubtitle('weigh', rem)).toBe('Раз на тиждень · понеділок');
    const custom = withReminder(settings(), 'measure', { day: 5 }).rem;
    expect(reminderSubtitle('measure', custom)).toBe('Раз на тиждень · пʼятниця');
    const none = withReminder(settings(), 'workout', { days: [], time: '07:30' }).rem;
    expect(reminderSubtitle('workout', none)).toBe('Дні не вибрані · 07:30');
  });

  it('patches one reminder without touching the others', () => {
    const before = settings();
    const after = withReminder(before, 'weigh', { on: false, time: '09:15' });
    expect(after.rem.weigh).toEqual({ on: false, day: 1, time: '09:15' });
    expect(after.rem.workout).toBe(before.rem.workout);
    expect(before.rem.weigh.on).toBe(true);
  });
});

describe('goals', () => {
  const KG = GOAL_LIMITS.kg;
  const KCAL = GOAL_LIMITS.kcal;

  it('steps and clamps to the shared goal limits', () => {
    expect(KG).toEqual({ min: 30, max: 200, step: 0.5 });
    expect(KCAL).toEqual({ min: 800, max: 5000, step: 50 });
    expect(stepValue(60, 1, KG)).toBe(60.5);
    expect(stepValue(60.1, 1, KG)).toBe(60.6);
    expect(stepValue(30, -1, KG)).toBe(30);
    expect(stepValue(199.8, 1, KG)).toBe(200);
    expect(stepValue(30.2, -1, KG)).toBe(30);
    expect(stepValue(1700, -1, KCAL)).toBe(1650);
    expect(stepValue(800, -1, KCAL)).toBe(800);
    expect(stepValue(5000, 1, KCAL)).toBe(5000);
  });

  it('moves a value from outside the limits one ordinary step towards them, never jumping', () => {
    expect(stepValue(25, 1, KG)).toBe(25.5);
    expect(stepValue(25, -1, KG)).toBe(25);
    expect(stepValue(250, -1, KG)).toBe(249.5);
    expect(stepValue(250, 1, KG)).toBe(250);
    expect(stepValue(6000, -1, KCAL)).toBe(5950);
    expect(stepValue(6000, 1, KCAL)).toBe(6000);
    expect(stepValue(500, 1, KCAL)).toBe(550);
    expect(stepValue(500, -1, KCAL)).toBe(500);
  });

  it('formats the rows like the prototype', () => {
    const [kg, kcal] = goalRows(settings());
    expect(kg).toMatchObject({
      label: 'Цільова вага',
      value: '60,0 кг',
      canDecrement: true,
      canIncrement: true,
    });
    expect(kcal).toMatchObject({ label: 'Калорії на день', value: `${f0(1700)} ккал` });
    expect(kcal?.value.replace(/\s/g, ' ')).toBe('1 700 ккал');
    expect(kg?.decrementLabel).toBe('Зменшити цільову вагу');
  });

  it('disables the buttons at the limits', () => {
    const [kg, kcal] = goalRows(settings({ goal: 30, kcalGoal: 5000 }));
    expect(kg?.canDecrement).toBe(false);
    expect(kg?.canIncrement).toBe(true);
    expect(kcal?.canIncrement).toBe(false);
  });

  it('offers only the way back into the limits for a goal outside them', () => {
    const outside = settings({ goal: 25, kcalGoal: 6000 });
    const [kg, kcal] = goalRows(outside);
    expect(kg).toMatchObject({ canDecrement: false, canIncrement: true });
    expect(kcal).toMatchObject({ canDecrement: true, canIncrement: false });
    expect(stepGoal(outside, 'kcalGoal', -1).kcalGoal).toBe(5950);
    expect(stepGoal(outside, 'goal', 1).goal).toBe(25.5);
  });

  it('updates settings immutably', () => {
    const before = settings();
    expect(stepGoal(before, 'goal', -1).goal).toBe(59.5);
    expect(stepGoal(before, 'kcalGoal', 1).kcalGoal).toBe(1750);
    expect(before.goal).toBe(60);
  });
});

describe('notifications panel', () => {
  it('maps every push status to copy and an action', () => {
    expect(notifView('default')).toEqual({
      sub: 'Дозволь Легко надсилати нагадування',
      cta: 'Увімкнути',
      action: 'enable',
      disabled: false,
      canTurnOff: false,
    });
    expect(notifView('enabled')).toMatchObject({
      sub: 'Нагадування приходять, навіть коли застосунок закритий',
      cta: 'Тест',
      action: 'test',
      canTurnOff: true,
    });
    expect(notifView('needs-install')).toMatchObject({
      sub: 'На iPhone нагадування працюють, коли Легко додано на початковий екран',
      cta: 'Як?',
      action: 'install',
      disabled: false,
    });
    expect(notifView('denied')).toMatchObject({
      sub: 'Сповіщення заборонені. Увімкни їх у Параметрах → Сповіщення → Легко',
      cta: 'Заблоковано',
      disabled: true,
    });
    expect(notifView('unsupported')).toMatchObject({
      sub: 'Цей браузер не підтримує сповіщення',
      cta: 'Недоступно',
      disabled: true,
    });
  });

  it('shows a disabled «…» while loading or busy', () => {
    expect(notifView(null)).toMatchObject({ cta: '…', disabled: true, action: null });
    expect(notifView('enabled', true)).toMatchObject({ cta: '…', disabled: true, action: 'test' });
  });

  it('uses the server message for API errors and a fallback otherwise', () => {
    expect(errorText(new ApiError(503, 'push_unavailable', 'Сповіщення недоступні на сервері'), 'x')).toBe(
      'Сповіщення недоступні на сервері',
    );
    expect(errorText(new ApiError(0, 'network', 'Немає зʼєднання з сервером'), 'x')).toBe(
      'Немає зʼєднання з сервером',
    );
    expect(errorText(new ApiError(502, 'internal', 'Bad Gateway'), 'запасний')).toBe('запасний');
    expect(errorText(new DOMException('push service error', 'AbortError'), 'запасний')).toBe('запасний');
  });
});

describe('custom workout types', () => {
  it('adds a trimmed name', () => {
    expect(addCustomType([], '  Йога   вдома ')).toEqual({
      ok: true,
      name: 'Йога вдома',
      types: ['Йога вдома'],
    });
    expect(addCustomType(['Плавання'], 'Йога')).toMatchObject({ ok: true, types: ['Плавання', 'Йога'] });
  });

  it('refuses empty, too long, duplicate and over-limit names', () => {
    expect(addCustomType([], '   ')).toEqual({ ok: false, error: 'Введи назву тренування' });
    expect(addCustomType([], 'я'.repeat(LIMITS.typeName + 1))).toEqual({
      ok: false,
      error: 'Назва задовга — до 40 символів',
    });
    expect(addCustomType([], 'кардіо')).toEqual({ ok: false, error: '«Кардіо» вже є у списку' });
    expect(addCustomType(['Йога'], 'ЙОГА')).toEqual({ ok: false, error: '«Йога» вже є у списку' });
    const full = Array.from({ length: LIMITS.customTypes }, (_, i) => `Тип ${i}`);
    expect(addCustomType(full, 'Ще один')).toEqual({ ok: false, error: 'Можна додати до 30 своїх типів' });
  });

  it('removes by exact name', () => {
    expect(removeCustomType(['Йога', 'Плавання'], 'Йога')).toEqual(['Плавання']);
  });
});

describe('sync status', () => {
  const base = { loaded: true, online: true, pending: 0, syncing: false };

  it('picks the line for each state', () => {
    expect(syncStatus(base)).toEqual({ text: 'Усе синхронізовано', tone: 'ok' });
    expect(syncStatus({ ...base, syncing: true, pending: 2 })).toEqual({
      text: 'Синхронізую…',
      tone: 'busy',
    });
    expect(syncStatus({ ...base, pending: 3 })).toEqual({ text: 'Очікує синхронізації: 3', tone: 'pending' });
    expect(syncStatus({ ...base, online: false, pending: 5 }).text).toBe(
      'Офлайн — 5 змін чекають на інтернет',
    );
    expect(syncStatus({ ...base, online: false, pending: 1 }).text).toBe(
      'Офлайн — 1 зміна чекає на інтернет',
    );
    expect(syncStatus({ ...base, online: false, pending: 3 }).text).toBe(
      'Офлайн — 3 зміни чекають на інтернет',
    );
    expect(syncStatus({ ...base, online: false })).toEqual({
      text: 'Офлайн — нових змін немає',
      tone: 'offline',
    });
  });

  it('uses Ukrainian plural forms', () => {
    const forms = (n: number) => plural(n, 'one', 'few', 'many');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(forms)).toEqual([
      'one',
      'few',
      'few',
      'many',
      'many',
      'many',
      'many',
      'one',
      'few',
      'many',
      'one',
      'many',
    ]);
  });
});

describe('parseBackup', () => {
  it('accepts an export file', () => {
    const data = { ...emptyData(), weights: [{ date: '2026-10-05', kg: 65.4 }] };
    expect(parseBackup(JSON.stringify(data))?.weights).toEqual([{ date: '2026-10-05', kg: 65.4 }]);
  });

  it('accepts backups made before «Часті страви» existed', () => {
    const { foods: _foods, ...old } = emptyData();
    expect(parseBackup(JSON.stringify(old))?.foods).toEqual([]);
  });

  it('rejects other files', () => {
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup('{"hello":"world"}')).toBeNull();
    expect(parseBackup(JSON.stringify({ ...emptyData(), settings: { goal: 'x' } }))).toBeNull();
  });

  it('accepts backups made before meals and macros: default meal types, no macro goals', () => {
    const data = emptyData();
    const { mealTypes: _types, macroGoals: _goals, ...oldSettings } = data.settings;
    const old = {
      ...data,
      settings: oldSettings,
      days: { '2026-10-01': { food: 'Борщ', kcal: 400, trained: null, types: [], notes: '' } },
      foods: [{ name: 'Борщ', portion: '300 г', kcal: 180, count: 2, lastUsed: '2026-10-01' }],
    };
    const parsed = parseBackup(JSON.stringify(old));
    expect(parsed?.settings.mealTypes).toEqual([...DEFAULT_MEAL_TYPES]);
    expect(parsed?.settings.macroGoals).toEqual({ protein: null, fat: null, carbs: null });
    expect(parsed?.days['2026-10-01']?.food).toBe('Борщ');
    expect(parsed?.days['2026-10-01']?.meals).toBeUndefined();
    expect(parsed?.foods[0]).not.toHaveProperty('protein');
  });

  it('keeps meals, her meal types, macro goals and dish macros of a new backup', () => {
    const data = emptyData();
    data.settings = {
      ...data.settings,
      mealTypes: ['Сніданок', 'Після тренування'],
      macroGoals: { protein: 90, fat: null, carbs: 200 },
    };
    data.days['2026-10-01'] = {
      food: 'Сніданок: Тост з тунцем',
      kcal: 320,
      trained: null,
      types: [],
      notes: '',
      meals: [
        {
          id: 'abcdefabcdef',
          type: 'Сніданок',
          time: '08:00',
          text: 'Тост з тунцем',
          kcal: 320,
          protein: 24,
          fat: 9,
          carbs: 30,
        },
      ],
    };
    data.foods = [
      {
        name: 'Тост з тунцем',
        portion: '1 шт',
        kcal: 320,
        count: 1,
        lastUsed: '2026-10-01',
        protein: 24,
        fat: 9,
        carbs: 30,
      },
    ];
    const parsed = parseBackup(JSON.stringify(data));
    expect(parsed?.settings.mealTypes).toEqual(['Сніданок', 'Після тренування']);
    expect(parsed?.settings.macroGoals).toEqual({ protein: 90, fat: null, carbs: 200 });
    expect(parsed?.days['2026-10-01']?.meals?.[0]?.type).toBe('Сніданок');
    expect(parsed?.foods[0]).toMatchObject({ protein: 24, fat: 9, carbs: 30 });
  });
});

describe('meal types', () => {
  const DEFAULTS = [...DEFAULT_MEAL_TYPES];
  const own = (n: number) => Array.from({ length: n }, (_, i) => `Прийом ${i + 1}`);

  describe('add', () => {
    it('appends a cleaned name at the end', () => {
      expect(addMealType(DEFAULTS, '  Після   тренування ')).toEqual({
        ok: true,
        changed: true,
        types: ['Сніданок', 'Обід', 'Вечеря', 'Перекус', 'Після тренування'],
      });
      expect(addMealType([], 'Другий сніданок')).toEqual({
        ok: true,
        changed: true,
        types: ['Другий сніданок'],
      });
    });

    it('does nothing for an empty input', () => {
      expect(addMealType(DEFAULTS, '')).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(addMealType(DEFAULTS, '   ')).toEqual({ ok: true, changed: false, types: DEFAULTS });
    });

    it('refuses a duplicate (any case, any spacing), a long name and a 13th type', () => {
      expect(addMealType(DEFAULTS, 'обід')).toEqual({ ok: false, error: 'Такий тип уже є' });
      expect(addMealType(['Другий сніданок'], 'другий  СНІДАНОК')).toEqual({
        ok: false,
        error: 'Такий тип уже є',
      });
      expect(addMealType(DEFAULTS, 'я'.repeat(LIMITS.mealTypeName))).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(addMealType(DEFAULTS, 'я'.repeat(LIMITS.mealTypeName + 1))).toEqual({
        ok: false,
        error: 'Назва — до 30 символів',
      });
      expect(addMealType(own(LIMITS.mealTypes - 1), 'Ще один')).toMatchObject({ ok: true, changed: true });
      expect(addMealType(own(LIMITS.mealTypes), 'Ще один')).toEqual({
        ok: false,
        error: 'Не більше 12 типів',
      });
      expect(MEAL_TYPE_ERRORS).toEqual({
        duplicate: 'Такий тип уже є',
        full: 'Не більше 12 типів',
        tooLong: 'Назва — до 30 символів',
      });
    });

    it('never changes the list it was given', () => {
      const types = ['Обід'];
      addMealType(types, 'Вечеря');
      expect(types).toEqual(['Обід']);
    });
  });

  describe('rename', () => {
    it('renames in place, keeping the order', () => {
      expect(renameMealType(DEFAULTS, 'Перекус', ' Перекуси ')).toEqual({
        ok: true,
        changed: true,
        types: ['Сніданок', 'Обід', 'Вечеря', 'Перекуси'],
      });
      expect(renameMealType(DEFAULTS, 'Обід', 'Ланч')).toMatchObject({
        types: ['Сніданок', 'Ланч', 'Вечеря', 'Перекус'],
      });
      // A name stored in another case is still found.
      expect(renameMealType(['обід'], 'Обід', 'Ланч')).toMatchObject({ changed: true, types: ['Ланч'] });
    });

    it('does nothing for an empty name, the same name or a type that is gone', () => {
      expect(renameMealType(DEFAULTS, 'Обід', '')).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(renameMealType(DEFAULTS, 'Обід', '  ')).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(renameMealType(DEFAULTS, 'Обід', ' Обід ')).toEqual({
        ok: true,
        changed: false,
        types: DEFAULTS,
      });
      expect(renameMealType(DEFAULTS, 'Полудень', 'Ланч')).toEqual({
        ok: true,
        changed: false,
        types: DEFAULTS,
      });
    });

    it('lets her change only the case of a name', () => {
      expect(renameMealType(['обід'], 'обід', 'Обід')).toEqual({ ok: true, changed: true, types: ['Обід'] });
    });

    it('refuses the name of another type (any case) and a long name', () => {
      expect(renameMealType(DEFAULTS, 'Перекус', 'вечеря')).toEqual({ ok: false, error: 'Такий тип уже є' });
      expect(renameMealType(DEFAULTS, 'Обід', 'я'.repeat(31))).toEqual({
        ok: false,
        error: 'Назва — до 30 символів',
      });
    });
  });

  describe('move', () => {
    it('moves one place up or down', () => {
      expect(moveMealType(DEFAULTS, 'Обід', -1)).toEqual({
        ok: true,
        changed: true,
        types: ['Обід', 'Сніданок', 'Вечеря', 'Перекус'],
      });
      expect(moveMealType(DEFAULTS, 'Обід', 1)).toEqual({
        ok: true,
        changed: true,
        types: ['Сніданок', 'Вечеря', 'Обід', 'Перекус'],
      });
    });

    it('does nothing at either end or for an unknown type', () => {
      expect(moveMealType(DEFAULTS, 'Сніданок', -1)).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(moveMealType(DEFAULTS, 'Перекус', 1)).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(moveMealType(DEFAULTS, 'Ланч', 1)).toEqual({ ok: true, changed: false, types: DEFAULTS });
      expect(moveMealType([], 'Обід', 1)).toEqual({ ok: true, changed: false, types: [] });
    });
  });

  describe('remove', () => {
    it('removes the type, down to an empty list', () => {
      expect(removeMealType(DEFAULTS, 'Обід')).toEqual({
        ok: true,
        changed: true,
        types: ['Сніданок', 'Вечеря', 'Перекус'],
      });
      expect(removeMealType(['Обід'], 'Обід')).toEqual({ ok: true, changed: true, types: [] });
      expect(removeMealType(DEFAULTS, 'Ланч')).toEqual({ ok: true, changed: false, types: DEFAULTS });
    });
  });

  describe('defaults', () => {
    it('knows which defaults are missing, by name in any case', () => {
      expect(missingDefaults(DEFAULTS)).toEqual([]);
      expect(missingDefaults(['обід', 'Після тренування'])).toEqual(['Сніданок', 'Вечеря', 'Перекус']);
      // A renamed default is a type of her own: the default counts as missing.
      expect(missingDefaults(['Сніданок', 'Обід', 'Вечеря', 'Перекуси'])).toEqual(['Перекус']);
      expect(missingDefaults([])).toEqual(DEFAULTS);
    });

    it('restores the missing defaults at the end of her list', () => {
      expect(restoreDefaultMealTypes(['Після тренування', 'Обід'])).toEqual({
        ok: true,
        changed: true,
        types: ['Після тренування', 'Обід', 'Сніданок', 'Вечеря', 'Перекус'],
      });
      expect(restoreDefaultMealTypes([])).toEqual({ ok: true, changed: true, types: DEFAULTS });
      expect(restoreDefaultMealTypes(DEFAULTS)).toEqual({ ok: true, changed: false, types: DEFAULTS });
    });

    it('restores only as many as fit under the cap of 12, and says so when none fit', () => {
      const ten = own(10);
      expect(restoreDefaultMealTypes(ten)).toEqual({
        ok: true,
        changed: true,
        types: [...ten, 'Сніданок', 'Обід'],
      });
      expect(restoreDefaultMealTypes(own(12))).toEqual({ ok: false, error: 'Не більше 12 типів' });
    });
  });

  describe('note', () => {
    // NBSP (U+00A0) shown as «_», like nutrition.test.ts: the only ordinary spaces are where a line may wrap.
    const note = (types: readonly string[]): string => mealTypesNote(types).replaceAll(NBSP, '_');

    it('shows the preselection by time for the defaults', () => {
      expect(note(DEFAULTS)).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Сніданок_· 13:00_—_Обід_· 16:30_—_Перекус_· ' +
          '19:00_—_Вечеря. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
    });

    it('reads as plain text once the NBSPs are spaces (what Testing Library and Playwright match)', () => {
      expect(mealTypesNote(DEFAULTS).replaceAll(NBSP, ' ')).toBe(
        'Тип нового прийому підказується за часом: 08:00 — Сніданок · 13:00 — Обід · 16:30 — Перекус · ' +
          '19:00 — Вечеря. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
    });

    it('drops a time that gives the same type as the one before (no snack type: 16:30 is still lunch)', () => {
      expect(note(['Сніданок', 'Обід', 'Вечеря'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Сніданок_· 13:00_—_Обід_· 19:00_—_Вечеря. ' +
          'Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
    });

    it('follows her own names (keywords, then positions)', () => {
      expect(note(['Ранкова каша', 'Ланч', 'Вечеря', 'Перекуси'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Ранкова каша_· 13:00_—_Ланч_· 16:30_—_Перекуси_· ' +
          '19:00_—_Вечеря. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
      expect(note(['Перший', 'Другий', 'Третій', 'Четвертий'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Перший_· 13:00_—_Другий_· 16:30_—_Четвертий_· ' +
          '19:00_—_Третій. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
      expect(note(['Одне'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Одне. Його завжди можна змінити. ' +
          'Перейменування не змінює вже записані прийоми.',
      );
    });

    it('follows a renamed list: «Вечір» for «Вечеря», and «Ранок» / «День» / «Вечір» in place of all three', () => {
      expect(note(['Ранок', 'День', 'Вечір', 'Перекус'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Ранок_· 13:00_—_День_· 16:30_—_Перекус_· ' +
          '19:00_—_Вечір. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
      expect(note(['Сніданок', 'Обід', 'Вечір', 'Перекус'])).toBe(
        'Тип нового прийому підказується за часом: 08:00_—_Сніданок_· 13:00_—_Обід_· 16:30_—_Перекус_· ' +
          '19:00_—_Вечір. Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
      );
    });

    it('never lets a line start with «—» or «·», or split a time from its type', () => {
      const lists: readonly (readonly string[])[] = [
        DEFAULTS,
        ['Сніданок', 'Обід', 'Вечеря'],
        ['Ранкова каша', 'Після тренування', 'Вечеря', 'Перекуси'],
        ['Одне'],
      ];
      for (const types of lists) {
        const text = mealTypesNote(types);
        // An ordinary space is a wrap point: none may sit right before or after a dash, or before a «·».
        expect(text).not.toMatch(/ —|— | ·/);
        for (const time of ['08:00', '13:00', '16:30', '19:00']) {
          if (text.includes(time)) expect(text).toContain(`${time}${NBSP}—${NBSP}`);
        }
      }
    });

    it('says a new meal has no name when her list is empty', () => {
      expect(mealTypesNote([])).toBe(
        'Без типів новий прийом буде без назви. Перейменування не змінює вже записані прийоми.',
      );
    });
  });

  describe('row keys', () => {
    it('keeps the key of every name that stays, and gives new names fresh keys', () => {
      const first = keyTypeRows(NO_TYPE_ROWS, ['Сніданок', 'Обід']);
      expect(first).toEqual({
        next: 2,
        rows: [
          { key: 0, name: 'Сніданок' },
          { key: 1, name: 'Обід' },
        ],
      });
      expect(keyTypeRows(first, ['Сніданок', 'Обід'])).toBe(first);
      expect(keyTypeRows(first, ['Обід', 'Вечеря', 'Сніданок'])).toEqual({
        next: 3,
        rows: [
          { key: 1, name: 'Обід' },
          { key: 2, name: 'Вечеря' },
          { key: 0, name: 'Сніданок' },
        ],
      });
    });

    it('carries the key over a rename', () => {
      const keys = keyTypeRows(NO_TYPE_ROWS, ['Сніданок', 'Обід']);
      const renamed = renameTypeRow(keys, 'Обід', 'Ланч');
      expect(renamed.rows).toEqual([
        { key: 0, name: 'Сніданок' },
        { key: 1, name: 'Ланч' },
      ]);
      expect(keyTypeRows(renamed, ['Сніданок', 'Ланч'])).toBe(renamed);
      expect(renameTypeRow(keys, 'Вечеря', 'Ланч')).toBe(keys);
    });
  });
});

describe('macro goals', () => {
  it('parses whole grams 1–1 000, spaces allowed', () => {
    expect(parseMacroGoal('90')).toBe(90);
    expect(parseMacroGoal(' 90 ')).toBe(90);
    expect(parseMacroGoal('1')).toBe(1);
    expect(parseMacroGoal('1 000')).toBe(1000);
    expect(parseMacroGoal(`1${f0(1000).charAt(1)}000`)).toBe(1000);
    expect(parseMacroGoal('090')).toBe(90);
  });

  it('reads an empty field as no goal', () => {
    expect(parseMacroGoal('')).toBeNull();
    expect(parseMacroGoal('   ')).toBeNull();
  });

  it('refuses anything else', () => {
    for (const text of ['0', '1001', '12,5', '12.5', '-5', '90 г', 'abc', '1e2']) {
      expect(parseMacroGoal(text), text).toBe('invalid');
    }
    expect(MACRO_GOAL_ERROR.replace(/\s/g, ' ')).toBe('Від 1 до 1 000 г');
  });

  it('fills the field from the stored goal', () => {
    expect(macroGoalText(90)).toBe('90');
    expect(macroGoalText(1000)).toBe('1000');
    expect(macroGoalText(null)).toBe('');
  });
});
