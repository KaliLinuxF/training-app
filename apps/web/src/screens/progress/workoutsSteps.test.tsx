/** «Мій прогрес» → Тренування (charts, burned kcal, top exercises) and the «Кроки» card (§3.15). */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '@legko/shared';
import { session, squat, walk } from '@/lib/stats/workouts.testing';
import { buildProgressModel, EXERCISES_SHOWN, HISTORY_FIRST, type ProgressOptions } from './model';
import { progressData, TODAY } from './progress.fixtures';
import { ProgressBody, type ProgressBodyProps } from './ProgressScreen';
import { NO_STEPS_IN_PERIOD } from './StepsCard';
import { TOP_EXERCISES } from './WorkoutsCard';

/** TODAY is Friday 2026-10-09: the week runs from Monday 2026-10-05. */
function withTraining(): AppData {
  const data = progressData();
  data.sessions = [
    session({ date: '2026-10-06', exercises: [squat()] }),
    session({ date: '2026-10-08', exercises: [squat(), walk()] }),
  ];
  data.steps = [
    { date: '2026-10-06', steps: 6000 },
    { date: '2026-10-07', steps: 11000 },
    { date: '2026-10-08', steps: 9000 },
  ];
  return data;
}

const opts = (patch: Partial<ProgressOptions> = {}): ProgressOptions => ({
  period: 'week',
  measure: 'waist',
  historyLimit: HISTORY_FIRST,
  ...patch,
});
const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

function renderBody(data: AppData, props: Partial<ProgressBodyProps> = {}) {
  const memory = memoryLocation({ path: '/progress', record: true });
  render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <ProgressBody data={data} today={TODAY} period="week" onPeriodChange={vi.fn()} {...props} />
    </Router>,
  );
  return memory;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => cleanup());

describe('progress model — workouts', () => {
  it('charts per day of the week: trained days and the volume of the done sessions', () => {
    const { workouts } = buildProgressModel(withTraining(), TODAY, opts());
    expect(workouts.charts.trainings.bars).toHaveLength(7);
    expect(workouts.charts.trainings.goalPct).toBeNull();
    expect(workouts.charts.volume.bars.map((b) => b.tone)).toEqual(['empty', 'idle', 'empty', 'idle', 'empty', 'empty', 'empty']);
    expect(workouts.charts.volume.hasData).toBe(true);
    expect(flat(workouts.charts.volume.label)).toBe('Обʼєм цього тижня по днях: усього 2 880 кг');
  });

  it('the burned line and the top exercises of the period', () => {
    const { workouts } = buildProgressModel(withTraining(), TODAY, opts());
    expect(flat(workouts.burned)).toMatch(/^Спалено на тренуваннях ≈ \d+ ккал · в сер\. \d+ ккал\/день$/);
    expect(workouts.exercises.map((e) => [e.exerciseId, e.value])).toEqual([
      ['lib.back-squat', '2'],
      ['lib.walk', '1'],
    ]);
    expect(workouts.exercises[0]?.ariaLabel).toBe('Присідання зі штангою: 2 тренування');
    expect(EXERCISES_SHOWN).toBe(5);
  });

  it('without sessions: no burned line, no exercises, the volume chart empty', () => {
    const { workouts } = buildProgressModel(progressData(), TODAY, opts());
    expect(workouts.burned).toBeNull();
    expect(workouts.exercises).toEqual([]);
    expect(workouts.charts.volume.hasData).toBe(false);
  });
});

describe('progress model — steps', () => {
  it('hidden when she never logged steps', () => {
    expect(buildProgressModel(progressData(), TODAY, opts()).steps).toBeNull();
  });

  it('without a goal: the average and the logged days, no goal line', () => {
    const steps = buildProgressModel(withTraining(), TODAY, opts()).steps;
    expect(steps?.stats.map((s) => [s.label, flat(s.value)])).toEqual([
      ['В сер. за день', '8 667'],
      ['Днів записано', '3'],
    ]);
    expect(steps?.chart.goalPct).toBeNull();
    expect(flat(steps?.burned)).toMatch(/^Спалено ≈ \d+ ккал на день$/);
  });

  it('with a goal: «Ціль» and «N з M» days, a goal line', () => {
    const data = withTraining();
    data.settings = { ...data.settings, stepsGoal: 9000 };
    const steps = buildProgressModel(data, TODAY, opts()).steps;
    expect(steps?.stats.map((s) => [s.label, flat(s.value)])).toEqual([
      ['В сер. за день', '8 667'],
      ['Ціль', '9 000'],
      ['Днів з ціллю', '2 з 3'],
    ]);
    expect(steps?.chart.goalPct).not.toBeNull();
    expect(flat(steps?.chart.label)).toBe('Кроки цього тижня, ціль 9 000');
  });

  it('a period without steps keeps the card (she logs steps) with a dash and the empty chart', () => {
    const data = withTraining();
    data.steps = [{ date: '2026-08-01', steps: 5000 }];
    const steps = buildProgressModel(data, TODAY, opts()).steps;
    expect(steps?.stats[0]).toMatchObject({ value: '—', tone: 'faint' });
    expect(steps?.chart.hasData).toBe(false);
    expect(steps?.burned).toBeNull();
  });
});

describe('ProgressBody — Тренування and Кроки', () => {
  it('the «Тренування | Обʼєм» switch shows only once a session has volume, and swaps the chart', () => {
    renderBody(withTraining());
    const card = within(screen.getByRole('region', { name: 'Тренування' }));
    expect(card.getByRole('img', { name: /^Тренування цього тижня/ })).toBeTruthy();
    fireEvent.click(card.getByRole('radio', { name: 'Обʼєм' }));
    expect(card.getByRole('img', { name: /^Обʼєм цього тижня/ })).toBeTruthy();
    cleanup();

    renderBody(progressData());
    const plain = within(screen.getByRole('region', { name: 'Тренування' }));
    expect(plain.queryByRole('radio', { name: 'Обʼєм' })).toBeNull();
    expect(plain.queryByText(TOP_EXERCISES)).toBeNull();
  });

  it('top exercises link to the exercise detail by default, with a back stamp', () => {
    const memory = renderBody(withTraining());
    const link = screen.getByRole('link', { name: 'Присідання зі штангою: 2 тренування. Відкрити вправу' });
    expect(link.getAttribute('href')).toBe('/workouts/library/lib.back-squat');
    fireEvent.click(link);
    expect(memory.history.at(-1)).toBe('/workouts/library/lib.back-squat');
  });

  it('exerciseHref null or the coach audience: static rows, no links', () => {
    renderBody(withTraining(), { exerciseHref: null });
    expect(screen.queryByRole('link', { name: /Відкрити вправу$/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Присідання зі штангою: 2 тренування' })).toBeTruthy();
    cleanup();

    renderBody(withTraining(), { audience: 'coach', exerciseHref: (id) => `/x/${id}` });
    expect(screen.queryByRole('link', { name: /Відкрити вправу$/ })).toBeNull();
    cleanup();

    renderBody(withTraining(), { exerciseHref: (id) => `/coach/7/ex/${id}` });
    expect(screen.getAllByRole('link', { name: /Відкрити вправу$/ })[0]?.getAttribute('href')).toBe(
      '/coach/7/ex/lib.back-squat',
    );
  });

  it('the «Кроки» card follows «Тренування», and is absent without steps', () => {
    const { container } = render(
      <Router hook={memoryLocation({ path: '/progress' }).hook}>
        <ProgressBody data={withTraining()} today={TODAY} period="week" onPeriodChange={vi.fn()} />
      </Router>,
    );
    const titles = [...container.querySelectorAll('section h2')].map((h) => flat(h.textContent));
    expect(titles.indexOf('Кроки')).toBe(titles.indexOf('Тренування') + 1);
    const steps = within(screen.getByRole('region', { name: 'Кроки' }));
    expect(steps.getByRole('img', { name: 'Кроки цього тижня' })).toBeTruthy();
    expect(steps.queryByText(NO_STEPS_IN_PERIOD)).toBeNull();
    cleanup();

    renderBody(progressData());
    expect(screen.queryByRole('region', { name: 'Кроки' })).toBeNull();
  });
});
