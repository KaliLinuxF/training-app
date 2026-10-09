import { emptyData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { FIELD_ERRORS } from '../validation';
import { hasSetupErrors, initSetupDraft, isSetupDirty, setupOps, validateSetup, type SetupDraft } from './model';

const TODAY = '2026-10-09';

const draft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  weight: '',
  goal: '60',
  kcalGoal: '1700',
  chest: '',
  waist: '',
  hips: '',
  ...patch,
});

describe('setup sheet model', () => {
  it('starts from the settings goals and today’s entries', () => {
    const data = emptyData();
    data.settings.goal = 58.5;
    data.weights = [{ date: TODAY, kg: 70.2 }];
    expect(initSetupDraft(data, TODAY)).toEqual(draft({ weight: '70,2', goal: '58,5' }));
    expect(initSetupDraft(emptyData(), TODAY)).toEqual(draft());
  });

  it('detects changes', () => {
    expect(isSetupDirty(draft(), draft())).toBe(false);
    expect(isSetupDirty(draft(), draft({ goal: '59,5' }))).toBe(true);
  });

  it('requires goal and kcal goal within GOAL_LIMITS (as in «Мої цілі»); current weight is optional', () => {
    expect(hasSetupErrors(validateSetup(draft()))).toBe(false);
    expect(validateSetup(draft({ goal: '' })).goal).toBe(FIELD_ERRORS.goalRequired);
    expect(validateSetup(draft({ goal: '29,5' })).goal).toBe(FIELD_ERRORS.goal);
    expect(validateSetup(draft({ goal: '200,5' })).goal).toBe(FIELD_ERRORS.goal);
    expect(validateSetup(draft({ goal: 'abc' })).goal).toBe(FIELD_ERRORS.goal);
    expect(validateSetup(draft({ goal: '30' })).goal).toBeUndefined();
    expect(validateSetup(draft({ goal: '200' })).goal).toBeUndefined();
    expect(validateSetup(draft({ kcalGoal: '' })).kcalGoal).toBe(FIELD_ERRORS.kcalGoalRequired);
    expect(validateSetup(draft({ kcalGoal: '750' })).kcalGoal).toBe(FIELD_ERRORS.kcalGoal);
    expect(validateSetup(draft({ kcalGoal: '5050' })).kcalGoal).toBe(FIELD_ERRORS.kcalGoal);
    expect(validateSetup(draft({ kcalGoal: '800' })).kcalGoal).toBeUndefined();
    expect(validateSetup(draft({ kcalGoal: '5000' })).kcalGoal).toBeUndefined();
    expect(FIELD_ERRORS.goal).toBe('Ціль — від 30 до 200 кг');
    expect(FIELD_ERRORS.kcalGoal).toBe('Від 800 до 5 000 ккал на день');
    // The current weight is a weigh-in: the data limits apply.
    expect(validateSetup(draft({ weight: '500' })).weight).toBe(FIELD_ERRORS.kg);
    expect(validateSetup(draft({ waist: '5' })).measure.invalid).toEqual(['waist']);
  });

  it('saves today’s weigh-in and measurements, the goals and onboarded', () => {
    const settings = emptyData().settings;
    const ops = setupOps(draft({ weight: '72,4', goal: '62,56', kcalGoal: '1650', waist: '80' }), settings, TODAY);
    expect(ops).toEqual([
      { kind: 'weight.put', date: TODAY, kg: 72.4 },
      { kind: 'measure.put', date: TODAY, value: { chest: null, waist: 80, hips: null } },
      { kind: 'settings.put', value: { ...settings, goal: 62.6, kcalGoal: 1650, onboarded: true } },
    ]);
  });

  it('leaves weigh-ins and measurements alone when they are empty', () => {
    const settings = emptyData().settings;
    expect(setupOps(draft(), settings, TODAY)).toEqual([
      { kind: 'settings.put', value: { ...settings, goal: 60, kcalGoal: 1700, onboarded: true } },
    ]);
  });
});
