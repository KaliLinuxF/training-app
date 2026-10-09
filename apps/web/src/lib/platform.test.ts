import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRules, readCss } from '@/ui/internal/cssSource';
import { installMatchMedia } from '@/ui/internal/testing';
import { DESKTOP_QUERY, useIsDesktop } from './platform';

interface Device {
  width: number;
  hover: boolean;
  finePointer: boolean;
}

/** Evaluates the `(feature: value) and …` queries the app uses against a fake device. */
const matcher =
  (d: Device) =>
  (query: string): boolean =>
    query.split(' and ').every((part) => {
      const m = /^\(([\w-]+): ?([\w]+)\)$/.exec(part.trim());
      if (!m) throw new Error(`unsupported media query «${part}»`);
      const [, feature, value] = m;
      if (feature === 'min-width') return d.width >= parseInt(value ?? '', 10);
      if (feature === 'hover') return d.hover === (value === 'hover');
      if (feature === 'pointer') return d.finePointer === (value === 'fine');
      throw new Error(`unsupported media feature «${feature}»`);
    });

const DEVICES: [string, Device, boolean][] = [
  ['desktop browser', { width: 1280, hover: true, finePointer: true }, true],
  ['narrow desktop window', { width: 800, hover: true, finePointer: true }, false],
  ['Pro Max iPhone in landscape', { width: 932, hover: false, finePointer: false }, false],
  ['iPhone in portrait', { width: 390, hover: false, finePointer: false }, false],
  ['iPad in landscape (touch)', { width: 1180, hover: false, finePointer: false }, false],
];

describe('desktop shell', () => {
  it.each(DEVICES)('%s → desktop: %s', (_name, device, desktop) => {
    installMatchMedia(matcher(device));
    expect(renderHook(() => useIsDesktop()).result.current).toBe(desktop);
  });

  it('the content grid switches to two columns under exactly the same condition', () => {
    const media = cssRules(readCss('ui/layout/ContentGrid.module.css'))
      .map((rule) => rule.media)
      .filter((m) => m !== null);
    expect(media.length).toBeGreaterThan(0);
    expect(new Set(media)).toEqual(new Set([DESKTOP_QUERY]));
  });
});
