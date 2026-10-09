/**
 * Dev only: fills a running local server with ~10 weeks of realistic demo data
 * (port of the design prototype's `seed()`), via login + POST /api/import.
 *
 *   pnpm --filter @legko/server exec tsx scripts/seed-demo.ts --port 3000 --password <DEV_PASSWORD>
 */
import { addDays, defaultSettings, parse, todayISO, type AppData, type DayEntry } from '@legko/shared';

const FOODS = [
  'Вівсянка з ягодами, омлет, салат з тунцем, гречка з куркою',
  'Сирники, суп, запечена риба з овочами',
  'Йогурт з гранолою, паста з овочами, сир, яблуко',
  'Омлет, борщ, курка з рисом, кефір',
  'Тост з авокадо, салат з куркою, індичка з броколі',
];
const PLAN: Record<number, string> = { 1: 'Верх тіла', 2: 'Кардіо', 3: 'Низ тіла', 5: 'Все тіло', 6: 'Прес' };

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
  const used = addDays(today, -1);
  data.foods = [
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, count: 6, lastUsed: used },
    { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 9, lastUsed: used },
    { name: 'Борщ', portion: '300 г', kcal: 180, count: 3, lastUsed: used },
    { name: 'Курка з рисом', portion: '350 г', kcal: 520, count: 2, lastUsed: used },
    { name: 'Яблуко', portion: '1 шт', kcal: 80, count: 4, lastUsed: used },
  ];
  return data;
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}

async function main(): Promise<void> {
  const origin = `http://127.0.0.1:${arg('port', '3000')}`;
  const password = arg('password', process.env.DEV_PASSWORD);
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const res = await fetch(`${origin}/api/import`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify(demoData(arg('today', todayISO()))),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status} ${await res.text()}`);
  console.log(`Seeded demo data into ${origin}`);
}

if (process.argv[1]?.includes('seed-demo')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
