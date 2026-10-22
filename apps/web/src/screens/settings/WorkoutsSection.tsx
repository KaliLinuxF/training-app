import { useId } from 'react';
import { LIBRARY_PATH, WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import { ListGroup, ListRow } from '@/ui';
import { WorkoutTypesCard } from './WorkoutTypesCard';
import s from './WorkoutsSection.module.css';

export interface WorkoutsSectionProps {
  customTypes: readonly string[];
  /** `h2` on the phone sub-page, `h3` in the desktop pane. */
  headingLevel: 'h2' | 'h3';
}

/**
 * Налаштування → «Тренування» (docs/workouts-steps-rebrand.md §3.17): links to «Мої тренування» (with how many she
 * has) and «Бібліотека вправ», then her workout types under «Мої типи».
 */
export function WorkoutsSection({ customTypes, headingLevel }: WorkoutsSectionProps) {
  const count = useAppData().workouts.length;
  const typesId = useId();
  const Heading = headingLevel;
  return (
    <>
      <ListGroup aria-label="Тренування і вправи">
        <ListRow
          href={WORKOUTS_PATH}
          icon="workout"
          iconTone="acc"
          title="Мої тренування"
          value={count > 0 ? String(count) : undefined}
          valueVariant="soft"
        />
        <ListRow href={LIBRARY_PATH} icon="search" iconTone="neutral" title="Бібліотека вправ" />
      </ListGroup>
      <section aria-labelledby={typesId} className={s.types}>
        <Heading id={typesId} className={s.caption}>
          Мої типи
        </Heading>
        <WorkoutTypesCard customTypes={customTypes} />
      </section>
    </>
  );
}
