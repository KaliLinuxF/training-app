import { GOAL_LIMITS, type MeasureKey } from '@legko/shared';
import { useState } from 'react';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { Sheet } from '@/ui';
import { KcalField, MeasureField, SAVE_FAILED, SaveFooter, WeightField } from '../fields/fields';
import { latestWeight, measurePlaceholders } from '../helpers';
import { useDraft } from '../useDraft';
import { useSheetGuard } from '../useSheetGuard';
import {
  hasSetupErrors,
  initSetupDraft,
  isSetupDirty,
  SETUP_HEADING,
  SETUP_INTRO,
  setupOps,
  validateSetup,
  type SetupDraft,
} from './model';
import s from './SetupSheet.module.css';

export interface SetupSheetProps {
  state: SheetState;
  open: boolean;
}

/** First-run setup: current weight, goal weight, kcal goal, optional measurements → «Почати». */
export function SetupSheet({ state, open }: SetupSheetProps) {
  const data = useAppData();
  const today = useToday();
  const { draft, dirty, update } = useDraft<SetupDraft>(state.key, {
    init: () => {
      const initial = initSetupDraft(data, today);
      return { baseline: initial, draft: initial };
    },
    current: initSetupDraft(data, today),
    differs: isSetupDirty,
  });
  const set = (patch: Partial<SetupDraft>) => update((d) => ({ ...d, ...patch }));
  const onMeasure = (key: MeasureKey, text: string) =>
    update((d) => {
      const next = { ...d };
      next[key] = text;
      return next;
    });

  // The draft the store refused to save; the message stays until she edits it.
  const [refused, setRefused] = useState<SetupDraft | null>(null);
  const errors = validateSetup(draft);
  const invalid = hasSetupErrors(errors);
  const { anchor, close } = useSheetGuard(dirty, open);
  const lastW = latestWeight(data);

  const start = () => {
    if (!open || invalid) return;
    if (!commit(...setupOps(draft, data.settings, today))) {
      setRefused(draft);
      return;
    }
    ui.closeSheet();
    ui.flash('Збережено');
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      heading={SETUP_HEADING}
      footer={
        <SaveFooter label="Почати" onSave={start} disabled={invalid} error={refused === draft ? SAVE_FAILED : undefined} />
      }
    >
      <span ref={anchor} hidden />
      <p className={s.intro}>{SETUP_INTRO}</p>
      <WeightField
        label="Поточна вага"
        hint="Найточніше — зранку, натщесерце"
        name="weight"
        value={draft.weight}
        onChange={(weight) => set({ weight })}
        base={lastW}
        error={errors.weight}
      />
      <WeightField
        label="Цільова вага"
        name="goal"
        step={GOAL_LIMITS.kg.step}
        range={GOAL_LIMITS.kg}
        value={draft.goal}
        onChange={(goal) => set({ goal })}
        base={data.settings.goal}
        error={errors.goal}
      />
      <KcalField
        label="Калорії на день"
        name="kcalGoal"
        range={GOAL_LIMITS.kcal}
        value={draft.kcalGoal}
        onChange={(kcalGoal) => set({ kcalGoal })}
        error={errors.kcalGoal}
      />
      <MeasureField
        label="Заміри (за бажанням)"
        values={draft}
        placeholders={measurePlaceholders(data, today)}
        onChange={onMeasure}
        error={errors.measure}
      />
    </Sheet>
  );
}
