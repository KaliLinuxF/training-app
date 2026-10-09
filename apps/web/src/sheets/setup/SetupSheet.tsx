import type { MeasureKey } from '@legko/shared';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { Button, Sheet } from '@/ui';
import { KcalField, MeasureField, WeightField } from '../fields/fields';
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
  const { draft, baseline, update } = useDraft<SetupDraft>(state.key, () => {
    const initial = initSetupDraft(data, today);
    return { baseline: initial, draft: initial };
  });
  const set = (patch: Partial<SetupDraft>) => update((d) => ({ ...d, ...patch }));
  const onMeasure = (key: MeasureKey, text: string) =>
    update((d) => {
      const next = { ...d };
      next[key] = text;
      return next;
    });

  const errors = validateSetup(draft);
  const invalid = hasSetupErrors(errors);
  const { anchor, close } = useSheetGuard(isSetupDirty(baseline, draft));
  const lastW = latestWeight(data);

  const start = () => {
    if (!open || invalid) return;
    commit(...setupOps(draft, data.settings, today));
    ui.closeSheet();
    ui.flash('Збережено');
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      heading={SETUP_HEADING}
      footer={
        <Button size="lg" fullWidth onClick={start} disabled={invalid}>
          Почати
        </Button>
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
        step={0.5}
        value={draft.goal}
        onChange={(goal) => set({ goal })}
        base={data.settings.goal}
        error={errors.goal}
      />
      <KcalField
        label="Калорії на день"
        name="kcalGoal"
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
