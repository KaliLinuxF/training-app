import { Card, cx, ProgressBar } from '@/ui';
import type { FoodDayTotals, GoalTone, MacroTotalView } from './foodDayModel';
import s from './DayNutritionCard.module.css';

export interface DayNutritionCardProps {
  totals: FoodDayTotals;
}

const TONE_CLASS: Readonly<Record<GoalTone, string | undefined>> = {
  ink: undefined,
  acc: s.over,
  acc2: s.reached,
};

/** Bars: mint up to the goal, lavender above it (never red). */
const barTone = (tone: GoalTone): 'acc' | 'acc2' => (tone === 'acc' ? 'acc' : 'acc2');

/**
 * «Підсумок дня» at the top of «Їжа» (docs/meals-macros.md §7.2): the day's kcal against the goal (28/700 number,
 * md bar, the goal line) and, when some macro is known or some goal is set, Білки / Жири / Вуглеводи — value, and a
 * small bar where she has a goal. Visible values keep the slash («68 / 90 г»); VoiceOver reads «68 з 90 г».
 */
export function DayNutritionCard({ totals }: DayNutritionCardProps) {
  const { kcal, macros, partialNote } = totals;
  return (
    <Card as="section" aria-label="Підсумок дня" gap={0} className={s.card}>
      <p className={s.kcal}>
        <span aria-hidden="true">
          <span className={cx(s.kcalValue, TONE_CLASS[kcal.tone])}>{kcal.value}</span>
          <span className={s.kcalGoal}>{kcal.goal}</span>
        </span>
        {kcal.speech && <span className="visually-hidden">{kcal.speech}</span>}
      </p>
      <ProgressBar value={kcal.pct} size="md" tone={barTone(kcal.tone)} className={s.kcalBar} />
      <p className={s.kcalText}>{kcal.text}</p>

      {macros && (
        <dl className={s.macros}>
          {macros.map((m) => (
            <MacroRow key={m.key} view={m} />
          ))}
        </dl>
      )}
      {partialNote && <p className={s.note}>{partialNote}</p>}
    </Card>
  );
}

/** «Білки | 68 / 90 г | ███░░»: the bar only with a goal (its cell stays, so the columns line up). */
function MacroRow({ view }: { view: MacroTotalView }) {
  const { name, value, speech, tone, hasGoal, pct } = view;
  return (
    <>
      <dt className={s.name}>{name}</dt>
      <dd className={cx(s.value, TONE_CLASS[tone])}>
        <span aria-hidden="true">{value}</span>
        <span className="visually-hidden">{speech}</span>
      </dd>
      <dd className={s.bar} aria-hidden="true">
        {hasGoal && <ProgressBar value={pct} size="sm" tone={barTone(tone)} />}
      </dd>
    </>
  );
}
