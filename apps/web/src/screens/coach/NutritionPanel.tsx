import type { AppData, CoachPeriod, ISODate } from '@legko/shared';
import { useId, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'wouter';
import {
  BarChart,
  Button,
  Card,
  CardHeader,
  ContentGrid,
  cx,
  FullRow,
  Legend,
  LegendItem,
  ListGroup,
  ListRow,
  StatStrip,
} from '@/ui';
import { COACH_COPY, goalWord, TAB_LABELS } from './copy';
import { calendarHref, type DetailParams } from './clientModel';
import { useReplaceParams } from './nav';
import { nutritionModel, type MacroDayCell } from './nutritionModel';
import s from './NutritionPanel.module.css';
import t from './tones.module.css';

/** Days of the meal journal shown at first and added by each «Показати ще». */
export const JOURNAL_PAGE = 7;

export interface NutritionPanelProps {
  clientId: string;
  data: AppData;
  /** The client's today. */
  today: ISODate;
  /** The page parameters: `days` (7 / 30) sets the range; «Відкрити день →» keeps the others. */
  params: DetailParams;
}

const MACRO_HEAD = [
  ['protein', COACH_COPY.protein, 'Б'],
  ['fat', COACH_COPY.fat, 'Ж'],
  ['carbs', COACH_COPY.carbs, 'В'],
] as const;

/**
 * «Харчування» (docs/coach-cabinet.md §6.6): kcal per day against the goal, the average of the full days, the
 * Б · Ж · В of each day with food (lavender above a goal, partial days marked «*»), and the meal journal with a link
 * to each day in «Календар».
 */
export function NutritionPanel({ clientId, data, today, params }: NutritionPanelProps) {
  const days: CoachPeriod = params.days;
  const model = useMemo(() => nutritionModel(data, today, days), [data, today, days]);
  const [limit, setLimit] = useState(JOURNAL_PAGE);
  const replace = useReplaceParams();
  const chartTitleId = useId();
  const tableTitleId = useId();
  const journalTitleId = useId();

  const openDay = (e: MouseEvent, href: string) => {
    e.preventDefault();
    replace(href);
  };

  return (
    <ContentGrid>
      <h2 className="visually-hidden">{TAB_LABELS.nutrition}</h2>

      <Card as="section" full aria-labelledby={chartTitleId}>
        <CardHeader title={COACH_COPY.kcalByDay} titleId={chartTitleId} meta={model.goalText} />
        {model.hasBarData ? (
          <>
            <BarChart
              bars={model.bars}
              goalPct={model.goalPct}
              gap={model.gap}
              labeled={model.labeled}
              aria-label={model.chartLabel}
            />
            <Legend>
              <LegendItem shape="square" color="acc2" label={COACH_COPY.withinGoal} />
              <LegendItem shape="square" color="acc" label={COACH_COPY.overGoal} />
            </Legend>
          </>
        ) : (
          <p className={s.empty}>{COACH_COPY.noKcal}</p>
        )}
        <StatStrip items={model.stats} columns={2} />
      </Card>

      <Card as="section" full aria-labelledby={tableTitleId}>
        <CardHeader title={COACH_COPY.macrosByDay} titleId={tableTitleId} />
        {model.macroRows.length === 0 ? (
          <p className={s.empty}>{COACH_COPY.noKcal}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <caption className="visually-hidden">{COACH_COPY.macrosByDay}</caption>
              <thead>
                <tr>
                  <th scope="col" className={s.dayCol}>
                    {COACH_COPY.day}
                  </th>
                  <th scope="col" className={s.num}>
                    {COACH_COPY.kcal}
                  </th>
                  {MACRO_HEAD.map(([key, long, short]) => {
                    const goal = model.goals[key];
                    return (
                      <th key={key} scope="col" className={s.num}>
                        <span className={s.long}>{long}</span>
                        <span className={s.short} aria-hidden="true">
                          {short}
                        </span>
                        {goal !== null && <span className={s.goal}>{goalWord(goal)}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {model.macroRows.map((row) => (
                  <tr key={row.date}>
                    <th scope="row" className={s.dayCol}>
                      {row.label}
                    </th>
                    <td className={cx(s.num, t[row.kcalTone])}>{row.kcal}</td>
                    {row.cells.map((cell) => (
                      <MacroCell key={cell.key} cell={cell} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {model.hasPartial && <p className={s.footnote}>{COACH_COPY.partialFootnote}</p>}
      </Card>

      {model.journal.length > 0 && (
        <>
          <FullRow>
            <h2 id={journalTitleId} className={s.journalTitle}>
              {COACH_COPY.journal}
            </h2>
          </FullRow>
          {model.journal.slice(0, limit).map((day) => {
            const href = calendarHref(clientId, params, day.date);
            return (
              <ListGroup
                key={day.date}
                title={day.title}
                headerRight={day.kcal ? <span className={s.dayKcal}>{day.kcal}</span> : undefined}
                footer={
                  <Link href={href} replace className={s.openDay} onClick={(e) => openDay(e, href)}>
                    {COACH_COPY.openDay}
                  </Link>
                }
              >
                {day.meals.map((meal) => (
                  <ListRow
                    key={meal.id}
                    title={meal.title}
                    value={meal.value}
                    valueTone={meal.hasKcal ? undefined : 'faint'}
                    valueVariant="soft"
                    sub={meal.content || undefined}
                  />
                ))}
              </ListGroup>
            );
          })}
          {model.journal.length > limit && (
            <FullRow>
              <Button variant="outline" fullWidth onClick={() => setLimit((n) => n + JOURNAL_PAGE)}>
                {COACH_COPY.showMore}
              </Button>
            </FullRow>
          )}
        </>
      )}
    </ContentGrid>
  );
}

function MacroCell({ cell }: { cell: MacroDayCell }) {
  return (
    <td className={cx(s.num, t[cell.tone])}>
      {cell.text}
      {cell.partial && (
        <>
          <span aria-hidden="true">*</span>
          <span className="visually-hidden">, {COACH_COPY.partialHidden}</span>
        </>
      )}
    </td>
  );
}
