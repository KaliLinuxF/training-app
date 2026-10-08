import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarChart, type ChartBar } from './BarChart';
import { LineChart, type LineChartGeometry } from './LineChart';

afterEach(cleanup);

const geometry: LineChartGeometry = {
  viewBox: '0 0 320 120',
  line: 'M6.0 80.0 L160.0 50.0 L314.0 30.0',
  area: 'M6.0 80.0 L160.0 50.0 L314.0 30.0 L314.0 120 L6.0 120 Z',
  dots: [
    { leftPct: 1.875, topPct: 66.7, size: 7 },
    { leftPct: 50, topPct: 41.7, size: 0 },
    { leftPct: 98.125, topPct: 25, size: 12 },
  ],
  tag: { leftPct: 98.125, topPct: 25, text: '65,4' },
  from: '10.08',
  to: '06.10',
};

describe('LineChart', () => {
  it('draws the line and the gradient area with a unique gradient id', () => {
    const { container } = render(
      <>
        <LineChart geometry={geometry} />
        <LineChart geometry={geometry} tone="acc2" height={120} />
      </>,
    );
    const gradients = Array.from(container.querySelectorAll('linearGradient'));
    expect(gradients).toHaveLength(2);
    const [a, b] = gradients.map((g) => g.id);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
    const firstArea = container.querySelector('svg path');
    expect(firstArea?.getAttribute('fill')).toBe(`url(#${a})`);
    expect(container.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('renders visible dots with their size and the value tag above the last one', () => {
    const { container } = render(<LineChart geometry={geometry} aria-label="Вага" />);
    const plot = container.querySelector('svg')?.parentElement;
    const overlays = Array.from(plot?.querySelectorAll<HTMLElement>(':scope > span') ?? []);
    const tag = screen.getByText('65,4');
    const dots = overlays.filter((el) => el !== tag);
    expect(dots).toHaveLength(2); // the 0-size dot is not rendered
    expect(dots[1]?.style.width).toBe('12px');
    expect(dots[1]?.style.left).toBe('98.125%');
    expect(tag.style.top).toBe('25%');
    expect(screen.getByRole('img', { name: 'Вага' })).toBeTruthy();
    expect(screen.getByText('10.08')).toBeTruthy();
    expect(screen.getByText('06.10')).toBeTruthy();
  });

  it('can hide the tag and show a middle footer label', () => {
    render(<LineChart geometry={geometry} showTag={false} middleLabel="Талія, см" />);
    expect(screen.queryByText('65,4')).toBeNull();
    expect(screen.getByText('Талія, см')).toBeTruthy();
  });

  it('copes with empty geometry', () => {
    const { container } = render(
      <LineChart geometry={{ line: '', area: '', dots: [], tag: null, from: '', to: '' }} />,
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(0);
  });
});

describe('BarChart', () => {
  const bars: ChartBar[] = [
    { heightPct: 64.2, tone: 'ok', label: 'Пн' },
    { heightPct: 3, tone: 'empty', label: 'Вт' },
    { heightPct: 88, tone: 'over', label: 'Ср' },
  ];

  it('sets bar heights, the goal line and the gap', () => {
    const { container } = render(<BarChart bars={bars} goalPct={80} gap="3px" aria-label="Калорії" />);
    const plot = screen.getByRole('img', { name: 'Калорії' }).firstElementChild as HTMLElement;
    expect(plot.style.gap).toBe('3px');
    const [goal, ...barEls] = Array.from(plot.children) as HTMLElement[];
    expect(goal?.style.bottom).toBe('80%');
    expect(barEls.map((b) => b.style.height)).toEqual(['64.2%', '3%', '88%']);
    expect(container.textContent).toBe('');
  });

  it('shows labels only when labeled', () => {
    const { rerender } = render(<BarChart bars={bars} goalPct={80} />);
    expect(screen.queryByText('Пн')).toBeNull();
    rerender(<BarChart bars={bars} goalPct={80} labeled />);
    expect(screen.getByText('Пн')).toBeTruthy();
    expect(screen.getByText('Ср')).toBeTruthy();
  });
});
