import { emptyData, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { parseSheetDeepLink } from './deepLinks';
import { stepsCount, stepSteps, stepsHint } from './helpers';
import { initRecordDraft, isRecordDirty, recordOps, validateRecord } from './record/model';
import { FIELD_ERRORS, groupedSteps, stepsError } from './validation';

const DATE = '2026-10-14';
const flat = (text: string | undefined) => (text ?? '').replace(/\s/g, ' ');

function data(patch: Partial<AppData> = {}): AppData {
  return { ...emptyData(), weights: [{ date: '2026-10-01', kg: 70 }], ...patch };
}

describe('steps input helpers', () => {
  it('stepsCount: digits only, empty or 0 = none', () => {
    expect(stepsCount('8 400')).toBe(8400);
    expect(stepsCount('8400')).toBe(8400);
    expect(stepsCount('')).toBeNull();
    expect(stepsCount('0')).toBeNull();
    expect(stepsCount('000')).toBeNull();
  });

  it('stepSteps: from empty at 0, never below 0 (then empty), never above 100 000', () => {
    expect(stepSteps('', 500)).toBe('500');
    expect(stepSteps('', -500)).toBe('');
    expect(stepSteps('300', -500)).toBe('');
    expect(stepSteps('8400', 1000)).toBe('9400');
    expect(stepSteps('99800', 1000)).toBe('100000');
  });

  it('stepsError: empty is fine; over 100 000 or not a number is not', () => {
    expect(stepsError('')).toBeUndefined();
    expect(stepsError('8 400')).toBeUndefined();
    expect(stepsError('100000')).toBeUndefined();
    expect(stepsError('100001')).toBe(FIELD_ERRORS.steps);
    expect(stepsError('12a')).toBe(FIELD_ERRORS.steps);
    expect(FIELD_ERRORS.steps).toBe('Кроки — не більше 100 000 за день');
  });

  it('groupedSteps: «8 400», «100 000», empty stays empty', () => {
    expect(groupedSteps('8400')).toBe('8 400');
    expect(groupedSteps('100000')).toBe('100 000');
    expect(groupedSteps('950')).toBe('950');
    expect(groupedSteps('')).toBe('');
  });

  it('stepsHint: «≈ N ккал» without a goal (her weight that day), the goal line with one', () => {
    expect(stepsHint(data(), DATE, '')).toBeNull();
    // 8 000 × 0,0005 × 70 = 280.
    expect(flat(stepsHint(data(), DATE, '8000')?.text)).toBe('≈ 280 ккал');
    // No weigh-in at all: 70 kg.
    expect(flat(stepsHint(emptyData(), DATE, '8000')?.text)).toBe('≈ 280 ккал');
    const goal = data();
    goal.settings = { ...goal.settings, stepsGoal: 10000 };
    expect(flat(stepsHint(goal, DATE, '8400')?.text)).toBe('Ціль 10 000 — ще 1 600');
    expect(stepsHint(goal, DATE, '8400')?.reached).toBe(false);
    expect(stepsHint(goal, DATE, '12000')).toEqual({ text: 'Ціль виконано ✓', reached: true });
    expect(flat(stepsHint(goal, DATE, '')?.text)).toBe('Ціль 10 000 — ще 10 000');
  });
});

describe('record model: steps', () => {
  const stored = () => data({ steps: [{ date: DATE, steps: 5000 }] });

  it('the draft carries the stored count as digits', () => {
    expect(initRecordDraft(stored(), DATE, 'steps').steps).toBe('5000');
    expect(initRecordDraft(data(), DATE, 'steps').steps).toBe('');
    expect(initRecordDraft(stored(), DATE, 'day').steps).toBe('5000');
  });

  it('a changed count puts, an emptied one deletes, an unchanged one sends nothing', () => {
    const d = stored();
    const baseline = initRecordDraft(d, DATE, 'steps');
    expect(isRecordDirty(baseline, { ...baseline, steps: '6000' })).toBe(true);
    expect(recordOps({ baseline, draft: { ...baseline, steps: '6000' }, data: d, date: DATE, mode: 'steps' })).toEqual([
      { kind: 'steps.put', date: DATE, steps: 6000 },
    ]);
    expect(recordOps({ baseline, draft: { ...baseline, steps: '' }, data: d, date: DATE, mode: 'steps' })).toEqual([
      { kind: 'steps.delete', date: DATE },
    ]);
    expect(recordOps({ baseline, draft: { ...baseline, steps: '0' }, data: d, date: DATE, mode: 'steps' })).toEqual([
      { kind: 'steps.delete', date: DATE },
    ]);
    expect(recordOps({ baseline, draft: baseline, data: d, date: DATE, mode: 'steps' })).toEqual([]);
  });

  it('a stale device never erases steps recorded elsewhere: only her change is written', () => {
    // She opened the full day before another device stored 7 000; she did not touch the steps.
    const before = data();
    const baseline = initRecordDraft(before, DATE, 'day');
    const now = data({ steps: [{ date: DATE, steps: 7000 }] });
    const ops = recordOps({ baseline, draft: { ...baseline, notes: 'Добре' }, data: now, date: DATE, mode: 'day' });
    expect(ops.some((op) => op.kind.startsWith('steps.'))).toBe(false);
  });

  it('only the steps sheet and the full day show and validate the field', () => {
    expect(validateRecord({ ...initRecordDraft(data(), DATE, 'steps'), steps: '200000' }, 'steps').steps).toBe(
      FIELD_ERRORS.steps,
    );
    expect(validateRecord({ ...initRecordDraft(data(), DATE, 'workout'), steps: '200000' }, 'workout').steps).toBeUndefined();
    // The weight sheet never writes steps, whatever the draft says.
    const d = data();
    const baseline = initRecordDraft(d, DATE, 'weight');
    expect(
      recordOps({ baseline, draft: { ...baseline, steps: '5000' }, data: d, date: DATE, mode: 'weight' }).some((op) =>
        op.kind.startsWith('steps.'),
      ),
    ).toBe(false);
  });
});

describe('deep links', () => {
  it('/?sheet=steps opens the steps sheet', () => {
    expect(parseSheetDeepLink('?sheet=steps')).toEqual({ mode: 'steps' });
  });
});
