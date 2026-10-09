import { describe, expect, it } from 'vitest';
import { kcalGoalView } from './kcalGoal';

const nb = (s: string) => s.replace(/\s/g, ' ');

describe('kcalGoalView', () => {
  it('shows the goal when nothing is recorded', () => {
    for (const kcal of [null, undefined, 0]) {
      const v = kcalGoalView(kcal, 1700);
      expect(v.state).toBe('empty');
      expect(v.pct).toBe(0);
      expect(nb(v.text)).toBe('Ціль — 1 700 ккал на день');
    }
  });

  it('counts down what is left within the goal', () => {
    const v = kcalGoalView(1050, 1700);
    expect(v.state).toBe('ok');
    expect(v.pct).toBeCloseTo(61.76, 1);
    expect(nb(v.text)).toBe('Залишилось 650 з 1 700 ккал');
    expect(nb(v.label)).toBe('1 050 з 1 700 ккал, залишилось 650');
  });

  it('says when the goal is reached exactly', () => {
    const v = kcalGoalView(1700, 1700);
    expect(v.state).toBe('reached');
    expect(v.pct).toBe(100);
    expect(nb(v.text)).toBe('Ціль досягнута — 1 700 ккал');
  });

  it('warns when the goal is exceeded', () => {
    const v = kcalGoalView(1820, 1700);
    expect(v.state).toBe('over');
    expect(v.pct).toBe(100);
    expect(nb(v.text)).toBe('Перевищено на 120 ккал · ціль 1 700');
    expect(nb(v.label)).toBe('Перевищено ціль на 120 ккал: 1 820 з 1 700 ккал');
  });
});
