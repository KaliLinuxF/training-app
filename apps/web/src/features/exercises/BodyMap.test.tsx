import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSCLE_LABELS, MUSCLES, type MuscleId } from '@legko/shared';
import { BodyMap, TAP_OUTLINE_MS } from './BodyMap';
import { regionsFor, type MuscleState } from './bodyMapModel';
import { MuscleChips } from './MuscleChips';
import s from './BodyMap.module.css';
import chipStyles from './MuscleChips.module.css';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const regionsOf = (root: Element, muscle: MuscleId) => [...root.querySelectorAll(`path[data-muscle="${muscle}"]`)];

describe('BodyMap', () => {
  it('md / lg: an image named by the muscles, both views with captions and a colour key', () => {
    render(<BodyMap primary={['quads', 'glutes']} secondary={['hamstrings']} size="lg" />);
    const img = screen.getByRole('img', {
      name: 'Основні мʼязи: квадрицепс, сідниці. Допоміжні: задня поверхня стегна.',
    });
    expect(img.getAttribute('viewBox')).toBe('0 0 220 232');
    expect(img.classList.contains(s.lg!)).toBe(true);
    expect(img.textContent).toContain('Спереду');
    expect(img.textContent).toContain('Ззаду');
    // quads: front, both sides; glutes: back; hamstrings: secondary.
    for (const p of regionsOf(img, 'quads')) expect(p.classList.contains(s.primary!)).toBe(true);
    expect(regionsOf(img, 'glutes')).toHaveLength(2);
    for (const p of regionsOf(img, 'glutes')) expect(p.classList.contains(s.primary!)).toBe(true);
    for (const p of regionsOf(img, 'hamstrings')) expect(p.classList.contains(s.secondary!)).toBe(true);
    for (const p of regionsOf(img, 'chest')) {
      expect(p.classList.contains(s.primary!)).toBe(false);
      expect(p.classList.contains(s.secondary!)).toBe(false);
    }
    expect(img.querySelectorAll(`.${s.region}`)).toHaveLength(regionsFor('both').length);
    const legend = img.parentElement!;
    expect(legend.textContent).toContain('Основні');
    expect(legend.textContent).toContain('Допоміжні');
  });

  it('thumb: decorative, one view cropped around the primary muscles, no captions', () => {
    const { container } = render(<BodyMap primary={['glutes', 'hamstrings']} size="thumb" />);
    expect(screen.queryByRole('img')).toBeNull();
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.dataset.view).toBe('back');
    expect(svg.querySelector('text')).toBeNull();
    const [x, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBe(h);
    expect(x).toBeGreaterThanOrEqual(120);
  });

  it('an explicit single view', () => {
    render(<BodyMap primary={['chest']} view="front" size="md" />);
    const img = screen.getByRole('img', { name: 'Основні мʼязи: груди.' });
    expect(img.getAttribute('viewBox')).toBe('0 0 100 232');
    expect(regionsOf(img, 'glutes')).toHaveLength(0);
  });

  it('a tap picks the region under it (hit-tested), outlines it for a second; the map is then decorative', () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    const { container } = render(<BodyMap primary={[]} size="lg" onRegionTap={onTap} />);
    expect(screen.queryByRole('img')).toBeNull();
    const svg = container.querySelector('svg')!;
    // Laid out at scale 1: 220 × 232 px.
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 232, right: 220, bottom: 232, x: 0, y: 0, toJSON: () => ({}) });
    const quads = regionsFor('both').find((r) => r.key === 'front-quads-right')!;
    fireEvent.click(svg, { clientX: quads.centroid[0], clientY: quads.centroid[1] });
    expect(onTap).toHaveBeenCalledWith('quads');
    for (const p of regionsOf(svg, 'quads')) expect(p.classList.contains(s.outlined!)).toBe(true);
    act(() => vi.advanceTimersByTime(TAP_OUTLINE_MS));
    for (const p of regionsOf(svg, 'quads')) expect(p.classList.contains(s.outlined!)).toBe(false);
    // Between the figures: nothing.
    fireEvent.click(svg, { clientX: 110, clientY: 120 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

function ChipsHost({ initial = { primary: [], secondary: [] } }: { initial?: MuscleState }) {
  const [state, setState] = useState<MuscleState>(initial);
  return (
    <MuscleChips
      primary={state.primary}
      secondary={state.secondary}
      onChange={setState}
      highlight="calves"
      aria-label="Мʼязи"
    />
  );
}

describe('MuscleChips', () => {
  it('15 toggles in a named group; a tap cycles not used → основний → допоміжний → not used', () => {
    render(<ChipsHost />);
    const group = screen.getByRole('group', { name: 'Мʼязи' });
    const chips = within(group).getAllByRole('button');
    expect(chips).toHaveLength(15);
    expect(chips.map((c) => c.textContent)).toEqual(MUSCLES.map((m) => MUSCLE_LABELS[m]));
    for (const c of chips) expect(c.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Плечі' }));
    const primary = screen.getByRole('button', { name: 'Плечі · основний' });
    expect(primary.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(primary);
    const secondary = screen.getByRole('button', { name: 'Плечі · допоміжний' });
    expect(secondary.getAttribute('aria-pressed')).toBe('true');
    expect(secondary.classList.contains(chipStyles.secondary!)).toBe(true);
    fireEvent.click(secondary);
    expect(screen.getByRole('button', { name: 'Плечі' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('highlights the chip of the region just tapped on the map', () => {
    render(<ChipsHost initial={{ primary: ['quads'], secondary: ['calves'] }} />);
    expect(screen.getByRole('button', { name: 'Литки · допоміжний' }).classList.contains(chipStyles.highlight!)).toBe(true);
    expect(screen.getByRole('button', { name: 'Квадрицепс · основний' }).classList.contains(chipStyles.highlight!)).toBe(false);
  });
});
