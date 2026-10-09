import { describe, expect, it } from 'vitest';
import { insertEstimate, unestimatedTail } from './tail';

describe('unestimatedTail / insertEstimate', () => {
  it('takes what was typed after the last estimated line', () => {
    expect(unestimatedTail('')).toBe('');
    expect(unestimatedTail('борщ і хліб')).toBe('борщ і хліб');
    expect(unestimatedTail('Вівсянка (250 г) — 320 ккал\nборщ\nхліб')).toBe('борщ, хліб');
    expect(unestimatedTail('Вівсянка (250 г) — 1 320 ккал')).toBe('');
    // Estimated lines group thousands with a (narrow) no-break space, like `f0`.
    expect(unestimatedTail('Піца — 1 650 ккал\nсалат')).toBe('салат');
    expect(unestimatedTail('Піца — 1 650 ккал\nсалат')).toBe('салат');
  });

  it('replaces the tail it was made from, otherwise appends', () => {
    const line = 'Борщ (300 г), хліб (1 скибка) — 420 ккал';
    expect(insertEstimate('Кава — 60 ккал\nборщ\nхліб', line, 'борщ, хліб')).toBe(`Кава — 60 ккал\n${line}`);
    expect(insertEstimate('борщ і хліб', line, 'борщ і хліб')).toBe(line);
    expect(insertEstimate('борщ і хліб змінено', line, 'борщ і хліб')).toBe(`борщ і хліб змінено\n${line}`);
    expect(insertEstimate('', line, '')).toBe(line);
    expect(insertEstimate('Кава — 60 ккал\n', line, '')).toBe(`Кава — 60 ккал\n${line}`);
  });
});
