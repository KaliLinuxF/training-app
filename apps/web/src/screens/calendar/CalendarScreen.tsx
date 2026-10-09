import { useState } from 'react';
import { Button, ContentGrid, ScreenHeader } from '@/ui';
import { DayCard } from './DayCard';
import { MonthCard } from './MonthCard';
import { useCalendarModel } from './useCalendarModel';
import s from './CalendarScreen.module.css';

/**
 * «Календар» (redesign A «Чек-лист дня», §4.6): the month grid and the selected day as a check-list whose rows open
 * the short sheets. `/calendar?date=YYYY-MM-DD` selects a day; «Сьогодні» comes back to today.
 */
export function CalendarScreen() {
  const m = useCalendarModel();
  // «Сьогодні» hides itself once pressed: bumped only when it held focus (keyboard, desktop click), so the month
  // card moves that focus to today's cell instead of letting it fall to <body>. A touch tap never focuses it.
  const [focusToday, setFocusToday] = useState(0);
  return (
    <ContentGrid>
      <ScreenHeader
        title="Календар"
        right={
          m.showToday ? (
            <Button
              variant="outline"
              size="sm"
              className={s.today}
              onClick={(e) => {
                const hadFocus = document.activeElement === e.currentTarget;
                m.goToday();
                if (hadFocus) setFocusToday((n) => n + 1);
              }}
            >
              Сьогодні
            </Button>
          ) : undefined
        }
      />
      <MonthCard month={m.month} onSelect={m.select} onStep={m.step} focusToday={focusToday} />
      <DayCard detail={m.detail} onOpen={m.open} onTrained={m.setTrained} reveal={m.revealTick} />
    </ContentGrid>
  );
}
