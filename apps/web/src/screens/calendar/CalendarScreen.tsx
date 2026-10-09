import { ui } from '@/store/ui';
import { ContentGrid, ScreenHeader } from '@/ui';
import { DayCard } from './DayCard';
import { History } from './History';
import { MonthCard } from './MonthCard';
import { useCalendarModel } from './useCalendarModel';

/**
 * «Календар» — month grid, the selected day's record and the latest entries
 * (prototype `isCal`, Tracker.dc.html lines 138–207). `/calendar?date=YYYY-MM-DD` selects a day.
 */
export function CalendarScreen() {
  const m = useCalendarModel();
  return (
    <ContentGrid>
      <ScreenHeader subtitle="Історія по днях" title="Календар" />
      <MonthCard month={m.month} onSelect={m.select} onStep={m.step} />
      <DayCard detail={m.detail} onEdit={() => ui.openSheet(m.selected, 'day')} />
      <History history={m.history} onOpen={m.openFromHistory} onMore={m.showMore} />
    </ContentGrid>
  );
}
