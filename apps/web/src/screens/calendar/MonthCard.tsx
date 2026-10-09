import type { ISODate } from '@legko/shared';
import { useId, useState } from 'react';
import { Card, cx, Legend, LegendItem, StepNav } from '@/ui';
import type { MonthCell, MonthModel } from './model';
import { useSwipe } from './useSwipe';
import s from './MonthCard.module.css';

export interface MonthCardProps {
  month: MonthModel;
  onSelect: (date: ISODate) => void;
  /** −1 = previous month, +1 = next month. */
  onStep: (delta: -1 | 1) => void;
}

type SlideDir = 'prev' | 'next' | null;

/** Month grid with ‹ › navigation, horizontal swipe and the «Заливка» legend (prototype lines 146–172). */
export function MonthCard({ month, onSelect, onStep }: MonthCardProps) {
  const titleId = useId();
  const slide = useSlideDirection(month.key);
  const swipe = useSwipe((dir) => {
    if (dir === 'right') onStep(-1);
    else if (month.canGoNext) onStep(1);
  });

  return (
    <Card as="section" gap={12} className={s.card} aria-labelledby={titleId}>
      <StepNav
        className={s.nav}
        surface="paper"
        onPrev={() => onStep(-1)}
        onNext={() => onStep(1)}
        prevLabel="Попередній місяць"
        nextLabel="Наступний місяць"
        canNext={month.canGoNext}
      >
        <h2 id={titleId} className={s.title} aria-live="polite">
          {month.title}
        </h2>
      </StepNav>

      <div className={s.calendar} {...swipe}>
        <div className={s.weekdays} aria-hidden="true">
          {month.weekdays.map((w) => (
            <span key={w} className={s.weekday}>
              {w}
            </span>
          ))}
        </div>
        <div
          key={month.key}
          className={cx(s.days, slide === 'next' && s.slideNext, slide === 'prev' && s.slidePrev)}
          role="group"
          aria-labelledby={titleId}
        >
          {month.cells.map((cell, i) =>
            cell ? (
              <DayCell key={cell.date} cell={cell} onSelect={onSelect} />
            ) : (
              <span key={`pad-${i}`} aria-hidden="true" />
            ),
          )}
        </div>
      </div>

      {/* Fill mode: food / workout swatches are tinted squares like the cells (deliberate deviation, SPEC §2). */}
      <Legend centered>
        <LegendItem shape="square" color="acc2T" label="Харчування" />
        <LegendItem shape="square" color="accT" label="Тренування" />
        <LegendItem color="solid" label="Вага / заміри" />
      </Legend>
    </Card>
  );
}

function DayCell({ cell, onSelect }: { cell: MonthCell; onSelect: (date: ISODate) => void }) {
  const className = cx(
    s.cell,
    s[cell.fill],
    cell.isToday && !cell.isSelected && s.today,
    cell.isFuture && s.future,
  );
  const content = (
    <>
      <span className={s.num}>{cell.day}</span>
      <span className={s.marks} aria-hidden="true">
        {cell.weighOrMeasure && <span className={s.dot} />}
      </span>
    </>
  );

  if (cell.isFuture) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      className={className}
      aria-label={cell.label}
      aria-pressed={cell.isSelected}
      aria-current={cell.isToday ? 'date' : undefined}
      onClick={() => onSelect(cell.date)}
    >
      {content}
    </button>
  );
}

/** Which way the grid should slide in after the shown month changed (`null` on first render). */
function useSlideDirection(key: string): SlideDir {
  const [state, setState] = useState<{ key: string; dir: SlideDir }>({ key, dir: null });
  if (state.key !== key) {
    const next = { key, dir: key > state.key ? 'next' : 'prev' } as const;
    setState(next);
    return next.dir;
  }
  return state.dir;
}
