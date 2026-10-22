/**
 * Dev only: fills ONE account of a running local server with ~10 weeks of realistic demo data
 * (port of the design prototype's `seed()`), via login + POST /api/import. Only that account's data is replaced.
 *
 *   pnpm --filter @legko/server exec tsx scripts/seed-demo.ts --port 3000 [--username anna] --password <DEV_PASSWORD>
 */
import {
  addDays,
  API,
  defaultSettings,
  meResponseSchema,
  normalizeDay,
  parse,
  todayISO,
  USER_HEADER,
  type AppData,
  type DayEntry,
  type Meal,
} from '@legko/shared';

const FOODS = [
  'Вівсянка з ягодами, омлет, салат з тунцем, гречка з куркою',
  'Сирники, суп, запечена риба з овочами',
  'Йогурт з гранолою, паста з овочами, сир, яблуко',
  'Омлет, борщ, курка з рисом, кефір',
  'Тост з авокадо, салат з куркою, індичка з броколі',
];
const PLAN: Record<number, string> = { 1: 'Верх тіла', 2: 'Кардіо', 3: 'Низ тіла', 5: 'Все тіло', 6: 'Прес' };

/** Meal layout of a day with 3 or 4 dishes: type, time, share of the day's kcal. */
const MEAL_PLANS: Record<number, readonly { type: string; time: string; share: number }[]> = {
  3: [
    { type: 'Сніданок', time: '08:30', share: 0.3 },
    { type: 'Обід', time: '13:00', share: 0.4 },
    { type: 'Вечеря', time: '19:30', share: 0.3 },
  ],
  4: [
    { type: 'Сніданок', time: '08:30', share: 0.25 },
    { type: 'Обід', time: '13:00', share: 0.35 },
    { type: 'Перекус', time: '16:30', share: 0.1 },
    { type: 'Вечеря', time: '19:30', share: 0.3 },
  ],
};

/** % of a meal's kcal from protein / fat / carbs, by type. */
const MACRO_SHARES: Record<string, { p: number; f: number; c: number }> = {
  Сніданок: { p: 0.18, f: 0.3, c: 0.52 },
  Обід: { p: 0.28, f: 0.32, c: 0.4 },
  Перекус: { p: 0.12, f: 0.35, c: 0.53 },
  Вечеря: { p: 0.32, f: 0.35, c: 0.33 },
};

const capitalized = (s: string): string => s.charAt(0).toLocaleUpperCase('uk') + s.slice(1);

/**
 * The day's food («Сніданок, обід, вечеря» dishes separated by «, ») as 3–4 typed meals with macros; the last
 * meal takes the kcal remainder, so the day's kcal stays exactly the same. Uses no randomness.
 */
function demoMeals(date: string, food: string, kcal: number, withPosition: boolean): Meal[] | null {
  const dishes = food.split(', ');
  const plan = MEAL_PLANS[dishes.length];
  if (!plan) return null;
  let left = kcal;
  return plan.map(({ type, time, share }, i): Meal => {
    const mealKcal = i === plan.length - 1 ? left : Math.round((kcal * share) / 10) * 10;
    left -= mealKcal;
    const m = MACRO_SHARES[type] ?? { p: 0, f: 0, c: 0 };
    const macros = {
      protein: Math.round((mealKcal * m.p) / 4),
      fat: Math.round((mealKcal * m.f) / 9),
      carbs: Math.round((mealKcal * m.c) / 4),
    };
    const text = capitalized(dishes[i] ?? '');
    const meal: Meal = { id: `demo-${date}-${i}`, type, time, text, kcal: mealKcal, ...macros };
    if (withPosition && i === 0)
      meal.items = [{ name: text, portion: '1 порція', kcal: mealKcal, ...macros }];
    return meal;
  });
}

export function demoData(today: string): AppData {
  let r = 11;
  const rnd = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  let s = addDays(today, -68);
  while (parse(s).getDay() !== 1) s = addDays(s, -1);
  const data: AppData = {
    days: {},
    weights: [],
    measures: [],
    foods: [],
    settings: { ...defaultSettings(), onboarded: true },
  };
  let k = 0;
  for (let d = s; d <= today; d = addDays(d, 1)) {
    const dow = parse(d).getDay();
    const isToday = d === today;
    if (dow === 1) {
      data.weights.push({ date: d, kg: Math.round((68.4 - k * 0.3 + (rnd() - 0.5) * 0.3) * 10) / 10 });
      data.measures.push({
        date: d,
        chest: Math.round((93 - k * 0.3 + (rnd() - 0.5) * 0.4) * 2) / 2,
        waist: Math.round((74.5 - k * 0.45 + (rnd() - 0.5) * 0.4) * 2) / 2,
        hips: Math.round((101 - k * 0.3 + (rnd() - 0.5) * 0.4) * 2) / 2,
      });
      k++;
    }
    if (rnd() < 0.07 && !isToday) continue;
    const e: DayEntry = {
      food: FOODS[Math.floor(rnd() * FOODS.length)]!,
      kcal: Math.round((1480 + rnd() * 420) / 10) * 10,
      trained: false,
      types: [],
      notes: '',
    };
    const planned = PLAN[dow];
    if (planned && rnd() < 0.82) {
      e.trained = true;
      e.types = [planned];
      if (rnd() < 0.3) e.types.push(planned === 'Прес' ? 'Кардіо' : 'Прес');
    }
    if (rnd() < 0.12) e.notes = 'Гарне самопочуття, випила 2 л води';
    if (isToday)
      Object.assign(e, { food: 'Вівсянка з бананом, кава', kcal: null, trained: null, types: [], notes: '' });
    data.days[d] = e;
  }
  // The last six days before today are logged as meals (no rnd(): every number above stays as it was).
  // Today and older days stay legacy days (one food text), so both shapes are always on screen.
  const used = addDays(today, -1);
  for (let back = 6; back >= 1; back--) {
    const d = addDays(today, -back);
    const e = data.days[d];
    if (!e || !e.food || e.kcal === null) continue;
    const meals = demoMeals(d, e.food, e.kcal, d === used);
    if (meals) data.days[d] = normalizeDay({ ...e, meals });
  }
  data.foods = [
    {
      name: 'Вівсянка з бананом',
      portion: '250 г',
      kcal: 320,
      count: 6,
      lastUsed: used,
      protein: 9,
      fat: 6,
      carbs: 58,
    },
    {
      name: 'Кава з молоком',
      portion: '1 чашка',
      kcal: 60,
      count: 9,
      lastUsed: used,
      protein: 3,
      fat: 3,
      carbs: 5,
    },
    { name: 'Борщ', portion: '300 г', kcal: 180, count: 3, lastUsed: used, protein: 6, fat: 9, carbs: 19 },
    {
      name: 'Курка з рисом',
      portion: '350 г',
      kcal: 520,
      count: 2,
      lastUsed: used,
      protein: 38,
      fat: 14,
      carbs: 60,
    },
    { name: 'Яблуко', portion: '1 шт', kcal: 80, count: 4, lastUsed: used },
  ];
  return data;
}

export const DEFAULT_SEED_USERNAME = 'anna';

export interface SeedOptions {
  /** `http://127.0.0.1:<port>`: also sent as `Origin` (the server's mutation guard). */
  origin: string;
  username: string;
  password: string;
  today: string;
  /** Injectable for tests (the app's `request`). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Logs in as `username` (a v4 session) and imports the demo data with `X-Legko-User` = the id from the login response
 * (D11). Returns that id.
 */
export async function seedDemo({
  origin,
  username,
  password,
  today,
  fetch: request = fetch,
}: SeedOptions): Promise<string> {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  const login = await request(`${origin}${API.login}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`);
  const me = meResponseSchema.safeParse(await login.json());
  if (!me.success)
    throw new Error('Login answered without an account: is the server older than this script?');
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const res = await request(`${origin}${API.import}`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, [USER_HEADER]: me.data.user.id },
    body: JSON.stringify(demoData(today)),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status} ${await res.text()}`);
  return me.data.user.id;
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}

async function main(): Promise<void> {
  const origin = `http://127.0.0.1:${arg('port', '3000')}`;
  const username = arg('username', process.env.DEV_USERNAME || DEFAULT_SEED_USERNAME);
  await seedDemo({
    origin,
    username,
    password: arg('password', process.env.DEV_PASSWORD),
    today: arg('today', todayISO()),
  });
  console.log(`Seeded demo data into ${username} at ${origin}`);
}

if (process.argv[1]?.includes('seed-demo')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
