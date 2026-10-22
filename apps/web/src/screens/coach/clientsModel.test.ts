import { describe, expect, it } from 'vitest';
import { client, empty, item, meals, NOW, quiet, steady, stubClients } from './coach.fixtures';
import {
  buildClientRows,
  DEFAULT_LIST_PARAMS,
  filterRows,
  listSearch,
  nextSort,
  parseListParams,
  SORT_FIRST_DIR,
  SORT_KEYS,
  sortRows,
  type ClientRowModel,
  type SortKey,
} from './clientsModel';

const NB = ' ';
const names = (rows: readonly ClientRowModel[]) => rows.map((r) => r.username);
const rows7 = () => buildClientRows(stubClients(), NOW, 7);
const row = (rows: readonly ClientRowModel[], name: string): ClientRowModel => {
  const found = rows.find((r) => r.username === name);
  if (!found) throw new Error(name);
  return found;
};

describe('buildClientRows', () => {
  it('orders by attention (more flags, then the more severe), then active · pending · disabled, then name', () => {
    expect(names(rows7())).toEqual(['marta', 'petro', 'ivan', 'olya', 'sofia', 'taras']);
    expect(row(rows7(), 'marta').flags.map((f) => f.kind)).toEqual(['no_records', 'no_weigh_in']);
    expect(row(rows7(), 'petro').flags.map((f) => f.kind)).toEqual(['inactive']);
  });

  it('formats the weight, its change, the way to the goal and kcal with their tones', () => {
    const olya = row(rows7(), 'olya');
    expect(olya.href).toBe(`/coach/${olya.id}`);
    expect(olya.cells.weight).toMatchObject({ text: '69,6', sub: { text: '−1,6 від старту', tone: 'acc2' } });
    expect(olya.cells.change).toMatchObject({ text: '−0,4', tone: 'acc2' });
    expect(olya.cells.goalPct.text).toBe('17%');
    expect(olya.cells.kcal).toMatchObject({ text: `1${NB}950`, goal: ` / 1${NB}700`, tone: 'acc', macros: null });
    expect(olya.cells.kcal.long).toBe(`калорії 1${NB}950 при цілі 1${NB}700, більше цілі`);
    expect(olya.cells.logged.text).toBe(`7${NB}/${NB}7`);
    expect(olya.cells.activity).toEqual({ text: 'сьогодні', tone: 'ink' });
    expect(olya.pills).toEqual([{ key: 'kcal_over', text: 'Калорії +15% за 7 днів', tone: 'acc' }]);
    expect(olya.phone).toEqual({
      value: '69,6 кг',
      sub: `−0,4 за тиждень · 1${NB}950 / 1${NB}700 ккал · активність сьогодні`,
    });

    const sofia = row(rows7(), 'sofia');
    expect(sofia.cells.kcal.tone).toBe('acc2');
  });

  it('shows «—» without data, the flag of an empty diary and the neutral pills of new / disabled accounts', () => {
    const rows = rows7();
    const ivan = row(rows, 'ivan');
    expect(ivan.cells.weight).toMatchObject({ text: '—', sub: null });
    expect(ivan.cells.change).toMatchObject({ text: '—', tone: 'faint' });
    expect(ivan.cells.goalPct).toMatchObject({ text: '—', pct: null });
    expect(ivan.cells.kcal).toMatchObject({ text: '—', goal: '', tone: 'faint' });
    expect(ivan.cells.logged.text).toBe(`0${NB}/${NB}7`);
    expect(ivan.cells.activity.text).toBe('вчора');
    // 10 days without a single record: the lavender flag, in its own words.
    expect(ivan.pills).toEqual([{ key: 'no_records', text: 'Жодного запису від реєстрації', tone: 'acc' }]);

    // Never signed in: said once, by the pill — the activity cell is «—», the phone line leaves it out.
    const petro = row(rows, 'petro');
    expect(petro.pills).toEqual([{ key: 'inactive', text: 'Ще не входили', tone: 'acc' }]);
    expect(petro.cells.activity).toEqual({ text: '—', tone: 'faint' });
    expect(petro.phone.sub).toBe(`Записи 0${NB}/${NB}7`);

    expect(row(rows, 'taras').pills).toEqual([{ key: 'status-disabled', text: 'Вимкнено', tone: 'neutral' }]);
    const pending = buildClientRows([item(client(9, 'nina', { status: 'pending', lastSeenAt: null }), empty())], NOW, 7)[0];
    expect(pending?.pills.map((p) => p.text)).toEqual(['Пароль не задано']);
    // Pending accounts carry no flag, so the cell still says they never signed in.
    expect(pending?.cells.activity).toEqual({ text: 'Ще не входили', tone: 'ink' });
  });

  it('calls a fresh account without records «Новий клієнт» (neutral), and no text ever has two tones', () => {
    const fresh = buildClientRows(
      [item(client(9, 'nina', { createdAt: NOW.getTime() - 86_400_000, lastSeenAt: NOW.getTime() - 3_600_000 }), empty())],
      NOW,
      7,
    )[0];
    expect(fresh?.flags).toEqual([]);
    expect(fresh?.pills).toEqual([{ key: 'new', text: 'Новий клієнт', tone: 'neutral' }]);

    const all = [...rows7(), ...(fresh ? [fresh] : []), ...buildClientRows(stubClients(), NOW, 30)];
    const tones = new Map<string, Set<string>>();
    for (const r of all)
      for (const p of r.pills) tones.set(p.text, (tones.get(p.text) ?? new Set()).add(p.tone));
    for (const [text, set] of tones) expect([text, set.size]).toEqual([text, 1]);
  });

  it('tones each macro average lavender only above its own goal and shows the goals that are set', () => {
    const data = meals();
    data.settings = { ...data.settings, macroGoals: { protein: 80, fat: 60, carbs: null } };
    const [sofia] = buildClientRows([item(client(4, 'sofia'), data)], NOW, 7);
    expect(sofia?.cells.kcal.macros).toEqual([
      { key: 'protein', text: '85', tone: 'acc', goal: '/80' },
      { key: 'fat', text: '51', tone: 'ink', goal: '/60' },
      { key: 'carbs', text: '178', tone: 'ink', goal: '' },
    ]);
    expect(sofia?.cells.kcal.long).toContain('білки 85 г, ціль 80 г, більше цілі');
    expect(sofia?.cells.kcal.long).toContain('жири 51 г, ціль 60 г');
  });

  it('tones workouts lavender only when fewer than planned so far (Monday «0 / 3» is not behind)', () => {
    const wednesday = buildClientRows([item(client(1, 'a'), steady()), item(client(2, 'b'), quiet())], NOW, 7);
    expect(row(wednesday, 'a').cells.workouts).toMatchObject({ text: `1${NB}/${NB}3`, tone: 'ink' });
    expect(row(wednesday, 'b').cells.workouts).toMatchObject({ text: `0${NB}/${NB}3`, tone: 'acc' });
    // Screen readers keep the spoken «з».
    expect(row(wednesday, 'b').cells.workouts.long).toBe('тренувань 0 з 3 за тиждень, за планом на сьогодні — 1');

    const monday = new Date('2026-10-12T09:00:00Z');
    const [m] = buildClientRows([item(client(1, 'a'), steady('2026-10-12'), monday)], monday, 7);
    expect(m?.cells.workouts).toMatchObject({ text: `0${NB}/${NB}3`, tone: 'ink' });
    expect(m?.summary.workouts.plannedSoFar).toBe(0);

    const noPlan = steady();
    noPlan.settings = { ...noPlan.settings, rem: { ...noPlan.settings.rem, workout: { ...noPlan.settings.rem.workout, days: [] } } };
    const [n] = buildClientRows([item(client(1, 'a'), noPlan)], NOW, 7);
    expect(n?.cells.workouts).toMatchObject({ text: '1', tone: 'ink' });
    expect(n?.cells.workouts.long).toBe('тренувань 1 за тиждень, за планом на сьогодні — 0');
  });

  it('follows the period: 30 days for the change, the records and the phone sub', () => {
    const olya = row(buildClientRows(stubClients(), NOW, 30), 'olya');
    expect(olya.cells.logged.text).toBe(`30${NB}/${NB}30`);
    expect(olya.cells.change.long).toMatch(/^за 30 днів /);
    expect(olya.phone.sub).toMatch(/ за 30 днів · /);
  });
});

describe('sorting', () => {
  it('starts every column in its most useful direction', () => {
    expect(SORT_FIRST_DIR).toEqual({
      name: 'asc',
      weight: 'desc',
      change: 'desc',
      goalPct: 'asc',
      kcal: 'desc',
      workouts: 'asc',
      logged: 'asc',
      activity: 'asc',
    });
    expect(SORT_KEYS).not.toContain('sinceStart');
  });

  it.each(SORT_KEYS)('cycles %s: first direction → the opposite → the default order', (key: SortKey) => {
    const first = SORT_FIRST_DIR[key];
    const opposite = first === 'asc' ? 'desc' : 'asc';
    const a = nextSort({ sort: null, dir: 'asc' }, key);
    expect(a).toEqual({ sort: key, dir: first });
    const b = nextSort(a, key);
    expect(b).toEqual({ sort: key, dir: opposite });
    expect(nextSort(b, key).sort).toBeNull();
    // Another column starts over at its own first direction.
    const other = SORT_KEYS.find((k) => k !== key) ?? 'name';
    expect(nextSort(b, other)).toEqual({ sort: other, dir: SORT_FIRST_DIR[other] });
  });

  it('keeps the rows without a value last in both directions', () => {
    const rows = rows7();
    const desc = sortRows(rows, 'kcal', 'desc');
    expect(desc[0]?.username).toBe('olya');
    expect(names(desc).slice(-2)).toEqual(['petro', 'ivan']);
    const values = desc.slice(0, 4).map((r) => r.summary.kcal.avg ?? 0);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(names(sortRows(rows, 'kcal', 'asc')).slice(-2)).toEqual(['petro', 'ivan']);
    expect(names(sortRows(rows, 'weight', 'asc')).slice(-2)).toEqual(['petro', 'ivan']);
  });

  it('sorts «Активність» longest ago first: who never signed in leads, and comes last the other way', () => {
    const rows = rows7();
    expect(names(sortRows(rows, 'activity', 'asc'))).toEqual(['petro', 'marta', 'taras', 'ivan', 'sofia', 'olya']);
    expect(names(sortRows(rows, 'activity', 'desc'))).toEqual(['olya', 'sofia', 'ivan', 'taras', 'marta', 'petro']);
    // Two who never signed in keep the default order between them.
    const twice = buildClientRows(
      [
        item(client(7, 'zoya', { createdAt: NOW.getTime() - 10 * 86_400_000, lastSeenAt: null }), empty()),
        ...stubClients(),
      ],
      NOW,
      7,
    );
    expect(names(sortRows(twice, 'activity', 'asc')).slice(0, 2)).toEqual(['petro', 'zoya']);
  });

  it('sorts names with the Ukrainian collation and returns to the default order', () => {
    const rows = rows7();
    expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['ivan', 'marta', 'olya', 'petro', 'sofia', 'taras']);
    expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['taras', 'sofia', 'petro', 'olya', 'marta', 'ivan']);
    expect(names(sortRows(sortRows(rows, 'name', 'desc'), null, 'asc'))).toEqual(names(rows));
    expect(names(sortRows(rows, 'activity', 'asc'))[0]).toBe('petro');
  });
});

describe('filterRows', () => {
  it('keeps those who need attention', () => {
    expect(names(filterRows(rows7(), 'attention', ''))).toEqual(['marta', 'petro', 'ivan', 'olya']);
    expect(filterRows(rows7(), 'all', '')).toHaveLength(6);
  });

  it('searches the name case-insensitively, trimmed, combined with the filter', () => {
    expect(names(filterRows(rows7(), 'all', 'OL'))).toEqual(['olya']);
    expect(names(filterRows(rows7(), 'all', '  ar '))).toEqual(['marta', 'taras']);
    expect(names(filterRows(rows7(), 'attention', 'ar'))).toEqual(['marta']);
    expect(filterRows(rows7(), 'all', 'zz')).toEqual([]);
  });
});

describe('URL parameters of /coach', () => {
  it('parses valid values and falls back to the defaults', () => {
    expect(parseListParams('')).toEqual(DEFAULT_LIST_PARAMS);
    expect(parseListParams('?days=30&show=attention&sort=kcal&dir=asc&q=ol')).toEqual({
      days: 30,
      show: 'attention',
      sort: 'kcal',
      dir: 'asc',
      q: 'ol',
    });
    expect(parseListParams('days=14&show=x&sort=sinceStart&dir=up')).toEqual(DEFAULT_LIST_PARAMS);
    expect(parseListParams('days=07')).toMatchObject({ days: 7 });
    // A sort without a valid direction takes its first direction.
    expect(parseListParams('sort=weight')).toMatchObject({ sort: 'weight', dir: 'desc' });
    expect(parseListParams('sort=weight&dir=sideways')).toMatchObject({ sort: 'weight', dir: 'desc' });
  });

  it('writes only what differs from the defaults and reads back the same', () => {
    expect(listSearch(DEFAULT_LIST_PARAMS)).toBe('');
    const params = { days: 30, show: 'attention', sort: 'kcal', dir: 'desc', q: 'ол я' } as const;
    const search = listSearch(params);
    expect(search).toBe('?days=30&show=attention&sort=kcal&dir=desc&q=%D0%BE%D0%BB+%D1%8F');
    expect(parseListParams(search)).toEqual(params);
    expect(listSearch({ ...DEFAULT_LIST_PARAMS, sort: 'name', dir: 'asc' })).toBe('?sort=name&dir=asc');
  });
});
