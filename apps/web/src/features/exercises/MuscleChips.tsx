import { MUSCLE_LABELS, MUSCLES, type MuscleId } from '@legko/shared';
import { Chip, ChipGroup, cx } from '@/ui';
import { cycleMuscle, roleOf, type MuscleState } from './bodyMapModel';
import s from './MuscleChips.module.css';

export interface MuscleChipsProps {
  primary: readonly MuscleId[];
  secondary: readonly MuscleId[];
  /** The next state after a tap (not used → primary → secondary → not used). */
  onChange: (next: MuscleState) => void;
  /** The chip of the region just tapped on the map: briefly highlighted. */
  highlight?: MuscleId | null;
  'aria-label'?: string;
  className?: string;
}

export const ROLE_SUFFIX = { primary: '· основний', secondary: '· допоміжний' } as const;

/**
 * The 15 muscle toggles of the editor — the exact and accessible input next to the tappable map. Each chip is an
 * `aria-pressed` toggle whose visible (and spoken) suffix says the role: «Плечі · основний».
 */
export function MuscleChips({ primary, secondary, onChange, highlight, className, ...aria }: MuscleChipsProps) {
  const state: MuscleState = { primary: [...primary], secondary: [...secondary] };
  return (
    <ChipGroup className={cx(s.group, className)} {...aria}>
      {MUSCLES.map((m) => {
        const role = roleOf(state, m);
        return (
          <Chip
            key={m}
            selected={role !== 'none'}
            data-role={role}
            className={cx(s.chip, role === 'secondary' && s.secondary, highlight === m && s.highlight)}
            onClick={() => onChange(cycleMuscle(state, m))}
          >
            {MUSCLE_LABELS[m]}
            {role !== 'none' && ' '}
            {role !== 'none' && <span className={s.suffix}>{ROLE_SUFFIX[role]}</span>}
          </Chip>
        );
      })}
    </ChipGroup>
  );
}
