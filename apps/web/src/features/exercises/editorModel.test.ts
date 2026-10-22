import { describe, expect, it } from 'vitest';
import {
  draftOf,
  exerciseFromDraft,
  hasErrors,
  NAME_REQUIRED,
  NAME_TAKEN,
  PRIMARY_REQUIRED,
  validateDraft,
} from './editorModel';
import { STEP } from './testData';

describe('editor draft', () => {
  it('a new draft: the name from the search (trimmed, ≤ 60), weight / dumbbells / moderate', () => {
    expect(draftOf(undefined, '  Степ ')).toEqual({
      name: 'Степ',
      kind: 'weight',
      primary: [],
      secondary: [],
      equipment: 'dumbbell',
      intensity: 'moderate',
    });
    expect(draftOf(undefined, 'я'.repeat(80)).name).toHaveLength(60);
  });

  it('editing: her exercise with the intensity nearest its MET', () => {
    expect(draftOf(STEP)).toEqual({
      name: 'Степ-аеробіка',
      kind: 'cardio',
      primary: ['quads'],
      secondary: ['calves'],
      equipment: 'other',
      intensity: 'moderate',
    });
  });
});

describe('validateDraft', () => {
  const base = { ...draftOf(), name: 'Тест-вправа', primary: ['quads' as const] };

  it('requires a name, unique among the library and her own (case-insensitive), the edited one aside', () => {
    expect(validateDraft({ ...base, name: '   ' }, [STEP]).name).toBe(NAME_REQUIRED);
    expect(validateDraft({ ...base, name: 'присідання' }, [STEP]).name).toBe(NAME_TAKEN);
    expect(validateDraft({ ...base, name: ' СТЕП-АЕРОБІКА ' }, [STEP]).name).toBe(NAME_TAKEN);
    expect(validateDraft({ ...base, name: 'Степ-аеробіка' }, [STEP], STEP.id).name).toBeUndefined();
    expect(hasErrors(validateDraft(base, [STEP]))).toBe(false);
  });

  it('needs a primary muscle unless the kind is cardio', () => {
    expect(validateDraft({ ...base, primary: [] }, []).muscles).toBe(PRIMARY_REQUIRED);
    expect(validateDraft({ ...base, primary: [], secondary: ['abs'] }, []).muscles).toBe(PRIMARY_REQUIRED);
    expect(validateDraft({ ...base, kind: 'cardio', primary: [] }, []).muscles).toBeUndefined();
  });
});

describe('exerciseFromDraft', () => {
  it('MET from the intensity preset of the kind; a tidy name', () => {
    const ex = exerciseFromDraft(
      { ...draftOf(), name: '  Тест   вправа ', kind: 'bodyweight', primary: ['abs'], intensity: 'high' },
      'ownExercise99',
    );
    expect(ex).toEqual({
      id: 'ownExercise99',
      name: 'Тест вправа',
      kind: 'bodyweight',
      primary: ['abs'],
      secondary: [],
      equipment: 'dumbbell',
      met: 8,
    });
    expect(exerciseFromDraft({ ...draftOf(), name: 'x', kind: 'weight', intensity: 'light' }, 'a').met).toBe(3.5);
    expect(exerciseFromDraft({ ...draftOf(), name: 'x', kind: 'cardio', intensity: 'high' }, 'a').met).toBe(10);
  });
});
