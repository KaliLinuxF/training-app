import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { isLibraryExerciseId, type Exercise } from '@legko/shared';
import { backState, cx, Icon, Pill } from '@/ui';
import { BodyMap } from './BodyMap';
import { exerciseSub } from './libraryModel';
import s from './ExerciseRow.module.css';

export interface ExerciseThumbProps {
  exercise: Pick<Exercise, 'primary' | 'secondary'>;
  className?: string;
}

/** The 44×44 body-map crop of an exercise's primary muscles, in a soft tile. Decorative. */
export function ExerciseThumb({ exercise, className }: ExerciseThumbProps) {
  return (
    <span className={cx(s.thumb, className)} aria-hidden="true">
      <BodyMap primary={exercise.primary} secondary={exercise.secondary} size="thumb" />
    </span>
  );
}

export type ExerciseRowProps = {
  exercise: Exercise;
  className?: string;
} & (
  | { href: string; current?: boolean; onToggle?: never; pressed?: never; onPick?: never }
  | { onToggle: () => void; pressed: boolean; href?: never; current?: never; onPick?: never }
  | { onPick: () => void; href?: never; current?: never; onToggle?: never; pressed?: never }
);

/**
 * One exercise in a list (the metrics of a kit `ListRow md`, with the thumb as its leading square): a link to its
 * page, a ✓ toggle (picker, many) or a button that picks it (picker, one). Her own exercises carry «моя».
 */
export function ExerciseRow(props: ExerciseRowProps) {
  const { exercise, className } = props;
  const [location] = useLocation();
  const own = !isLibraryExerciseId(exercise.id);
  const content: ReactNode = (
    <>
      <ExerciseThumb exercise={exercise} className={s.lead} />
      <span className={s.title}>{exercise.name}</span>{' '}
      <span className={s.sub}>{exerciseSub(exercise)}</span>
      {own && (
        <>
          {' '}
          <Pill tone="acc" size="sm" className={s.pill}>
            моя
          </Pill>
        </>
      )}
      {props.onToggle !== undefined ? (
        <span className={cx(s.check, props.pressed && s.checked)} aria-hidden="true">
          {props.pressed && <Icon name="check" size={20} />}
        </span>
      ) : (
        <span className={s.chevron} aria-hidden="true">
          {props.href !== undefined && <Icon name="chevronRight" size={16} />}
          {props.onPick !== undefined && <Icon name="plus" size={20} />}
        </span>
      )}
    </>
  );

  let action: ReactNode;
  if (props.href !== undefined) {
    action = (
      <Link
        href={props.href}
        state={backState(location)}
        aria-current={props.current ? 'page' : undefined}
        className={s.action}
      >
        {content}
      </Link>
    );
  } else if (props.onToggle !== undefined) {
    action = (
      <button type="button" className={s.action} aria-pressed={props.pressed} onClick={props.onToggle}>
        {content}
      </button>
    );
  } else {
    action = (
      <button type="button" className={s.action} onClick={props.onPick}>
        {content}
      </button>
    );
  }
  return <li className={cx(s.item, className)}>{action}</li>;
}
