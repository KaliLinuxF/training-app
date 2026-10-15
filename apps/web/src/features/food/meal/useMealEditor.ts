/**
 * `useMealEditor(target)`: the state of the meal editor «Прийом їжі» for its host (docs/meals-macros.md §8.1) —
 * the draft (reset per `target.key` / `mealId`, retargeted on a date-only change of a new meal), the estimate
 * requests, validation, «Зберегти» (`meal.put` + `food.use`) and «Видалити прийом» (`meal.delete`).
 */
import { f0, mealsOf, todayISO, type AppData, type ISODate } from '@legko/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mealTitle } from '@/lib/nutrition';
import { dataActions, getAppData, useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { putDraft, recalcRows } from '../drafts';
import { useEstimateRunner, type EstimateAction, type EstimateDeps } from '../estimate';
import {
  addCustomMealType,
  buildMeal,
  contextPhoto,
  initMealDraft,
  MEAL_HINTS,
  mealDraftDirty,
  mealReducer,
  mealUses,
  nowHM,
  photoCapacity,
  retargetMealDraft,
  validateMeal,
  type AddedType,
  type MealAction,
  type MealDraft,
  type MealTarget,
  type MealValidation,
} from './mealModel';

export const MEAL_SHEET_HEADING = 'Прийом їжі';

/** «Видалити прийом» asks this first. */
export const DELETE_MEAL_CONFIRM = {
  title: 'Видалити прийом їжі?',
  confirmLabel: 'Видалити',
  cancelLabel: 'Залишити',
  destructive: true,
} as const;

/** The draft and its actions, as `MealEditorBody` reads them (opaque to hosts). */
export interface MealSession {
  /** The open's key: a new one is a new session (the body starts afresh). */
  readonly key: number;
  readonly date: ISODate;
  readonly draft: MealDraft;
  readonly validation: MealValidation;
  dispatch: (action: MealAction) => void;
  /** «✨ Порахувати» / «Порахувати решту» / the composer: `counts` is the meal text it counts, if any. */
  estimateText: (text: string, counts: string | null) => void;
  estimatePhoto: (file: File, hint: string, counts: string | null) => void;
  /** «Скасувати» while «Рахую калорії…». */
  cancelEstimate: () => void;
  /** «✨ Перерахувати» (the open item editor's draft in place of its row). */
  recalculate: () => void;
  /** «+ Свій»: adds the type to her list (when there is room) and selects it. */
  addType: (input: string) => AddedType | null;
}

export interface MealEditor {
  readonly target: MealTarget | null;
  readonly isNew: boolean;
  /** Something would be lost on close: draft changed, estimate loading, item editor changes. */
  readonly dirty: boolean;
  /** «Зберегти» can act (content, valid, no recalculation running). */
  readonly canSave: boolean;
  /** Why «Зберегти» is disabled (for aria-describedby / a hint line), else undefined. */
  readonly saveHint?: string;
  /** The store refused the last save (cleared on the next edit). */
  readonly saveError?: string;
  /** Commits meal.put (+ food.use); false keeps the draft. */
  save(): boolean;
  /** Existing meals: confirm → meal.delete; true when deleted. */
  remove(): Promise<boolean>;
  /** @internal What `MealEditorBody` renders; kept after `target` goes null, for the exit animation. */
  readonly session: MealSession | null;
}

/** Test seams; the app uses the real API, toast and clock. */
export interface MealEditorDeps {
  estimate?: EstimateDeps;
  now?: () => Date;
}

interface Session {
  key: number;
  mealId: string | null;
  date: ISODate;
  draft: MealDraft;
  saveError?: string;
}

const systemNow = (): Date => new Date();

function openSession(data: AppData, target: MealTarget, now: Date): Session {
  return {
    key: target.key,
    mealId: target.mealId,
    date: target.date,
    draft: initMealDraft(data, target, nowHM(now), todayISO(now)),
  };
}

/** Call unconditionally; `null` = idle (no state, never dirty). */
export function useMealEditor(target: MealTarget | null, deps: MealEditorDeps = {}): MealEditor {
  const data = useAppData();
  const clock = deps.now ?? systemNow;
  const [session, setSession] = useState<Session | null>(() =>
    target ? openSession(data, target, clock()) : null,
  );

  let current = session;
  if (target !== null) {
    if (current === null || current.key !== target.key || current.mealId !== target.mealId) {
      current = openSession(data, target, clock());
      setSession(current);
    } else if (current.date !== target.date) {
      const now = clock();
      const draft = current.draft.isNew
        ? retargetMealDraft(current.draft, data, target.date, nowHM(now), todayISO(now))
        : initMealDraft(data, target, nowHM(now), todayISO(now));
      current = { ...current, date: target.date, draft };
      setSession(current);
    }
  }

  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  const dispatch = useCallback((action: MealAction) => {
    setSession(
      (s) => s && { key: s.key, mealId: s.mealId, date: s.date, draft: mealReducer(s.draft, action) },
    );
  }, []);

  // Answers arrive later: the photo cap is checked against the day as it is then.
  const estimateDispatch = useCallback((action: EstimateAction) => {
    setSession((s) => {
      if (!s) return s;
      const capacity = photoCapacity(getAppData(), s.date, s.draft);
      return { ...s, draft: mealReducer(s.draft, { type: 'estimate', action, capacity }) };
    });
  }, []);

  const runner = useEstimateRunner(current?.date ?? '', estimateDispatch, deps.estimate);
  const { abort } = runner;

  // Another meal (or closed): its request is dropped.
  const identity = target ? `${target.key}:${target.mealId ?? ''}` : null;
  useEffect(() => abort, [identity, abort]);

  const recalculate = useCallback(() => {
    const s = latest.current;
    if (!s) return;
    const p = s.draft.positions;
    if (p.recalc.pending !== null || p.loading) return;
    // Asked for in the editor: her draft is priced as part of the meal, in place of its row.
    const rows = recalcRows(p.editor ? putDraft(p.drafts, p.editor.item) : p.drafts);
    if (rows) runner.recalculate(rows, contextPhoto(s.draft));
  }, [runner]);

  const addType = useCallback(
    (input: string): AddedType | null => {
      const added = addCustomMealType(input, getAppData().settings.mealTypes);
      if (!added) return null;
      const next = added.mealTypes;
      if (next) dataActions.updateSettings((st) => ({ ...st, mealTypes: next }));
      dispatch({ type: 'type', value: added.name });
      return added;
    },
    [dispatch],
  );

  const save = useCallback((): boolean => {
    const s = latest.current;
    if (!s || !target) return false;
    if (validateMeal(getAppData(), s.date, s.draft).hint !== undefined) return false;
    const ok = dataActions.saveMeal(s.date, buildMeal(s.draft), mealUses(s.draft));
    setSession((x) =>
      x && x.key === s.key
        ? ok
          ? { ...x, draft: mealReducer(x.draft, { type: 'estimate', action: { type: 'saved' } }) }
          : { ...x, saveError: MEAL_HINTS.saveError }
        : x,
    );
    return ok;
  }, [target]);

  const remove = useCallback(async (): Promise<boolean> => {
    const s = latest.current;
    if (!s || !target || s.draft.isNew) return false;
    const stored = mealsOf(getAppData().days[s.date]).find((m) => m.id === s.draft.id);
    const shown = stored ?? buildMeal(s.draft);
    const body = shown.kcal === null ? mealTitle(shown) : `${mealTitle(shown)} · ${f0(shown.kcal)} ккал`;
    const ok = await ui.confirm({ ...DELETE_MEAL_CONFIRM, body });
    if (!ok) return false;
    return dataActions.deleteMeal(s.date, s.draft.id);
  }, [target]);

  const active = target !== null && current !== null;
  const validation = current ? validateMeal(data, current.date, current.draft) : {};
  const saveError = active ? current?.saveError : undefined;

  return {
    target,
    isNew: current?.draft.isNew ?? true,
    dirty: active && current !== null && mealDraftDirty(current.draft),
    canSave: active && validation.hint === undefined,
    ...(active && validation.hint !== undefined ? { saveHint: validation.hint } : {}),
    ...(saveError !== undefined ? { saveError } : {}),
    save,
    remove,
    session: current && {
      key: current.key,
      date: current.date,
      draft: current.draft,
      validation,
      dispatch,
      estimateText: runner.fromText,
      estimatePhoto: runner.fromPhoto,
      cancelEstimate: runner.cancel,
      recalculate,
      addType,
    },
  };
}
