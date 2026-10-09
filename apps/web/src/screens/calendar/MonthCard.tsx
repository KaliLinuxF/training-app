import type { ISODate } from '@legko/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Card, cx, Legend, LegendItem, StepNav } from '@/ui';
import type { MonthCell, MonthModel } from './model';
import { useSwipe } from './useSwipe';
import s from './MonthCard.module.css';

export interface MonthCardProps {
  month: MonthModel;
  onSelect: (date: ISODate) => void;
  /** −1 = previous month, +1 = next month. */
  onStep: (delta: -1 | 1) => void;
  /**
   * Bumped when the header «Сьогодні» was pressed while it held focus (`0` / omitted = never): the button hides
   * itself, so today's cell takes the focus instead of `<body>`.
   */
  focusToday?: number;
}

type SlideDir = 'prev' | 'next' | null;

const PREV_LABEL = 'Попередній місяць';
const NEXT_LABEL = 'Наступний місяць';

/**
 * Month grid with ‹ › navigation, horizontal swipe and the «Заливка» legend (prototype lines 146–172).
 * `onSelect` is the cell-tap path only: the screen reveals the day card after it.
 *
 * Focus never falls to `<body>`: when › brings back the current month it turns disabled, so if it held focus,
 * ‹ takes it (not the `aria-live` title, which would announce the month twice).
 */
export function MonthCard({ month, onSelect, onStep, focusToday = 0 }: MonthCardProps) {
  const titleId = useId();
  const calendarRef = useRef<HTMLDivElement>(null);
  const nextHadFocus = useRef(false);
  const slide = useSlideDirection(month.key);

  const step = (delta: -1 | 1) => {
    const next = arrow(calendarRef.current, NEXT_LABEL);
    nextHadFocus.current = next !== null && document.activeElement === next;
    onStep(delta);
  };
  const swipe = useSwipe((dir) => {
    if (dir === 'right') step(-1);
    else if (month.canGoNext) step(1);
  });

  useEffect(() => {
    if (nextHadFocus.current && !month.canGoNext) {
      arrow(calendarRef.current, PREV_LABEL)?.focus({ preventScroll: true });
    }
    nextHadFocus.current = false;
  }, [month.key, month.canGoNext]);

  // Runs in the commit that already shows today's month; today is never a future day, so its cell is a button.
  useEffect(() => {
    if (focusToday === 0) return;
    calendarRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-current="date"]')
      ?.focus({ preventScroll: true });
  }, [focusToday]);

  return (
    <Card as="section" gap={12} className={s.card} aria-labelledby={titleId}>
      <StepNav
        className={s.nav}
        surface="paper"
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevLabel={PREV_LABEL}
        nextLabel={NEXT_LABEL}
        canNext={month.canGoNext}
      >
        <h2 id={titleId} className={s.title} aria-live="polite">
          {month.title}
        </h2>
      </StepNav>

      <div ref={calendarRef} className={s.calendar} {...swipe}>
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
        <LegendItem shape="square" color="acc2T" label="Їжа" />
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

/** One of the card's ‹ › buttons, found from inside the card (StepNav and Card forward no refs). */
function arrow(inside: Element | null, label: string): HTMLButtonElement | null {
  return (
    inside?.closest('section')?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null
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
