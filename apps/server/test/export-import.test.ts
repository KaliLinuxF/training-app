import { defaultSettings, emptyData, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createTestServer, json } from './helpers';

const sample: AppData = {
  days: {
    '2026-10-09': { food: 'Вівсянка', kcal: 1500, trained: true, types: ['Кардіо', 'Прес'], notes: 'легко' },
    '2026-10-10': { food: '', kcal: 1800, trained: false, types: [], notes: '' },
  },
  weights: [
    { date: '2026-10-03', kg: 66 },
    { date: '2026-10-10', kg: 65.4 },
  ],
  measures: [{ date: '2026-10-10', chest: 90, waist: 70, hips: 98.5 }],
  settings: { ...defaultSettings(), goal: 60, onboarded: true },
};

describe('export / import', () => {
  it('round-trips everything', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const imported = await s.call('/api/import', { cookie, body: sample });
    expect(imported.status).toBe(200);
    expect(await json(imported)).toEqual({ ok: true });

    const res = await s.call('/api/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    // Clock is 2026-10-09 09:00 UTC = 12:00 in Kyiv.
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="legko-2026-10-09.json"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const exported = await json<AppData>(res);
    expect(exported).toEqual(sample);

    // Importing the export into a fresh server reproduces the same data.
    const other = await createTestServer();
    const otherCookie = await other.login();
    expect((await other.call('/api/import', { cookie: otherCookie, body: exported })).status).toBe(200);
    expect(await json(await other.call('/api/data', { cookie: otherCookie }))).toEqual(sample);
  });

  it('replaces existing data instead of merging', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/ops', {
      cookie,
      body: { ops: [{ kind: 'weight.put', date: '2025-01-01', kg: 80 }] },
    });
    await s.call('/api/import', { cookie, body: sample });
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.weights).toEqual(sample.weights);
  });

  it('normalises imported records the same way ops do', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const messy: AppData = {
      ...emptyData(),
      days: {
        '2026-10-01': { food: '  ', kcal: null, trained: null, types: [], notes: '' },
        '2026-10-02': { food: ' Суп ', kcal: null, trained: false, types: ['Кардіо'], notes: '' },
      },
      measures: [{ date: '2026-10-01', chest: null, waist: null, hips: null }],
    };
    expect((await s.call('/api/import', { cookie, body: messy })).status).toBe(200);
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.days).toEqual({
      '2026-10-02': { food: 'Суп', kcal: null, trained: false, types: [], notes: '' },
    });
    expect(data.measures).toEqual([]);
  });

  it.each([
    ['missing settings', { days: {}, weights: [], measures: [] }],
    ['duplicate weight dates', { ...sample, weights: [...sample.weights, { date: '2026-10-10', kg: 65 }] }],
    ['invalid date key', { ...sample, days: { '2026-13-01': sample.days['2026-10-09'] } }],
    ['weight out of range', { ...sample, weights: [{ date: '2026-10-10', kg: 4 }] }],
    ['not an object', [1, 2, 3]],
  ])('rejects %s with bad_request and keeps the old data', async (_name, body) => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/import', { cookie, body: sample });
    const res = await s.call('/api/import', { cookie, body });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
    expect(await json(await s.call('/api/data', { cookie }))).toEqual(sample);
  });
});
