import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ui, useUiStore } from '@/store/ui';
import { TrainingToggle } from './controls/TrainingToggle';
import { Banner } from './feedback/Banner';
import { ProgressBar } from './feedback/ProgressBar';
import { Toast } from './feedback/Toast';
import { Icon } from './icons/Icon';
import { ICON_PATHS, type IconName } from './icons/paths';
import { readCss } from './internal/cssSource';
import { lockScroll } from './internal/scrollLock';
import { stubScrollTo } from './internal/testing';
import { ScreenHeader } from './layout/ScreenHeader';
import groupStyles from './lists/ListGroup.module.css';
import { ListGroup } from './lists/ListGroup';
import rowStyles from './lists/ListRow.module.css';
import { ListRow } from './lists/ListRow';
import { DetailRow } from './tiles/DetailRow';
import { StatStrip } from './tiles/StatStrip';
import stripStyles from './tiles/StatStrip.module.css';
import { Tile } from './tiles/Tile';
import { deltaTone } from './tone';
import toneStyles from './tone.module.css';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

/** Renders inside an in-memory router at `path`; `memory.history` records every navigation. */
function inRouter(node: ReactNode, path = '/settings') {
  const memory = memoryLocation({ path, record: true });
  const view = render(<Router hook={memory.hook}>{node}</Router>);
  return { memory, ...view };
}

const cls = (name: string | undefined): string => {
  if (!name) throw new Error('missing CSS module class');
  return name;
};

describe('deltaTone', () => {
  it('ports the prototype tone(): down is mint, up is lavender, ~0 or missing is ink', () => {
    expect(deltaTone(-0.4)).toBe('acc2');
    expect(deltaTone(1)).toBe('acc');
    expect(deltaTone(0.04)).toBe('ink');
    expect(deltaTone(-0.04)).toBe('ink');
    expect(deltaTone(null)).toBe('ink');
    expect(deltaTone(undefined)).toBe('ink');
    expect(deltaTone(Number.NaN)).toBe('ink');
  });
});

describe('lockScroll', () => {
  it('pins the body and restores it when the last lock is released', () => {
    const scrollTo = stubScrollTo();
    const a = lockScroll();
    const b = lockScroll();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    a();
    a(); // idempotent
    expect(document.body.style.position).toBe('fixed');
    b();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});

describe('Toast', () => {
  it('shows the flashed text in a live region and removes it after it fades out', () => {
    vi.useFakeTimers();
    render(<Toast />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    act(() => ui.flash('Збережено', 1000));
    expect(region.textContent).toBe('Збережено');
    act(() => vi.advanceTimersByTime(1000));
    expect(useUiStore.getState().toast).toBeNull();
    // Still visible during the exit transition…
    expect(region.textContent).toBe('Збережено');
    act(() => vi.advanceTimersByTime(500));
    expect(region.textContent).toBe('');
  });
});

describe('Tile', () => {
  it('becomes a button when clickable', () => {
    const onClick = vi.fn();
    render(<Tile variant="entry" label="Харчування" value="Записано" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Харчування/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('DetailRow', () => {
  it('shows a dash for empty values', () => {
    render(
      <>
        <DetailRow label="Нотатки" value="" />
        <DetailRow label="Вага" value="65,4 кг" />
      </>,
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('65,4 кг')).toBeTruthy();
  });
});

describe('ProgressBar', () => {
  it('clamps the fill and is decorative without a label', () => {
    const { container, rerender } = render(<ProgressBar value={140} />);
    const track = container.firstElementChild as HTMLElement;
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect((track.firstElementChild as HTMLElement).style.width).toBe('100%');
    rerender(<ProgressBar value={42.4} label="Шлях до цілі" />);
    const bar = screen.getByRole('progressbar', { name: 'Шлях до цілі' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('is phrasing content (spans), so it may sit inside a <button>', () => {
    const { container } = render(<ProgressBar value={40} tone="acc2" size="sm" />);
    const track = container.firstElementChild as HTMLElement;
    expect(track.tagName).toBe('SPAN');
    expect(track.firstElementChild?.tagName).toBe('SPAN');
    expect(container.querySelector('div')).toBeNull();
  });
});

describe('Banner', () => {
  it('fires the CTA', () => {
    const onAction = vi.fn();
    render(
      <Banner title="Контрольне зважування" sub="Сьогодні о 08:00" cta="Записати" onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Записати' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe('Banner compact', () => {
  it('hides with the ✕ «Сховати» and fires the CTA', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Banner
        size="compact"
        title="Додай Легко на екран «Додому»"
        sub="Тоді працюватимуть нагадування"
        cta="Як?"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сховати' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Як?' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('has no CTA button without `cta`, and takes a custom ✕ name', () => {
    render(
      <Banner size="compact" title="Почнімо" onDismiss={() => undefined} dismissLabel="Закрити підказку" />,
    );
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Закрити підказку',
    ]);
  });

  it('has no ✕ without onDismiss', () => {
    render(<Banner title="Почнімо" cta="Почати" onAction={() => undefined} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Почати']);
  });
});

describe('Icon', () => {
  it('is decorative and sized, drawing every path of its glyph', () => {
    const { container } = render(<Icon name="gear" size={20} className="x" />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('class')).toBe('x');
    expect(svg.querySelectorAll('path')).toHaveLength(ICON_PATHS.gear.length);
  });

  it('defaults to 24px', () => {
    const { container } = render(<Icon name="home" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });

  it('ships the lucide ISC notice for the derived `gear` path, as a legal comment that minifiers keep', () => {
    const source = readCss('ui/icons/paths.ts');
    // First statement of the file, `/*!` + `@license`: kept at statement level by esbuild / terser.
    expect(source.startsWith('/*! @license Lucide «settings» icon')).toBe(true);
    const notice = source.slice(0, source.indexOf('*/'));
    expect(notice).toContain('ISC License');
    expect(notice).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    const text = notice.replace(/\n \*/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain(
      'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby ' +
        'granted, provided that the above copyright notice and this permission notice appear in all copies.',
    );
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES');
  });

  /** Absolute end points of every path segment (control points and arc bulges are not checked). */
  function endPoints(d: string): [number, number][] {
    const argc: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    const points: [number, number][] = [];
    let [x, y, startX, startY] = [0, 0, 0, 0];
    for (const [, cmd = '', args = ''] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
      const nums = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
      const upper = cmd.toUpperCase();
      const rel = cmd !== upper;
      const n = argc[upper] ?? 0;
      if (n === 0) {
        [x, y] = [startX, startY];
        continue;
      }
      for (let i = 0; i < nums.length; i += n) {
        const a = nums.slice(i, i + n);
        if (upper === 'H') x = (rel ? x : 0) + (a[0] ?? 0);
        else if (upper === 'V') y = (rel ? y : 0) + (a[0] ?? 0);
        else {
          x = (rel ? x : 0) + (a[n - 2] ?? 0);
          y = (rel ? y : 0) + (a[n - 1] ?? 0);
        }
        if (upper === 'M' && i === 0) [startX, startY] = [x, y];
        points.push([x, y]);
      }
    }
    return points;
  }

  it('the end-point reader follows relative and implicit commands', () => {
    expect(endPoints('M3 4h2v3l1 1Z')).toEqual([
      [3, 4],
      [5, 4],
      [5, 7],
      [6, 8],
    ]);
    expect(endPoints('M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z')).toEqual([
      [12, 9],
      [12, 15],
      [12, 9],
    ]);
  });

  it.each(Object.keys(ICON_PATHS) as IconName[])('%s stays inside the 3–21 content box', (name) => {
    for (const d of ICON_PATHS[name]) {
      for (const [px, py] of endPoints(d)) {
        const where = `${name}: ${d}`;
        expect(px, where).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(px, where).toBeLessThanOrEqual(21 + 1e-9);
        expect(py, where).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(py, where).toBeLessThanOrEqual(21 + 1e-9);
      }
    }
  });
});

describe('ListGroup', () => {
  const rows = (
    <>
      <ListRow title="Їжа" />
      <ListRow title="Вага" />
    </>
  );

  it('lists the rows in a ul role=list, one li per row; flush drops the list padding', () => {
    render(<ListGroup aria-label="Розділи">{rows}</ListGroup>);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list.classList.contains(cls(groupStyles.flush))).toBe(false);
    cleanup();
    render(<ListGroup flush>{rows}</ListGroup>);
    expect(screen.getByRole('list').classList.contains(cls(groupStyles.flush))).toBe(true);
  });

  it('is a region named by its title, never by the subtitle', () => {
    render(
      <ListGroup
        title="Сьогодні"
        subtitle="середа · сьогодні"
        headerRight={<button type="button">Відкрити день →</button>}
        footer="Підвал"
        note="Примітка"
      >
        {rows}
      </ListGroup>,
    );
    const region = screen.getByRole('region', { name: 'Сьогодні' });
    expect(region.tagName).toBe('SECTION');
    expect(within(region).getByRole('heading', { level: 2, name: 'Сьогодні' })).toBeTruthy();
    expect(within(region).getByText('середа · сьогодні')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Відкрити день →' })).toBeTruthy();
    expect(within(region).getByText('Підвал')).toBeTruthy();
    expect(within(region).getByText('Примітка')).toBeTruthy();
  });

  it('uses a given titleId for the heading', () => {
    render(
      <ListGroup title="7 жовтня 2026" titleSize="lg" titleId="day-title">
        {rows}
      </ListGroup>,
    );
    const heading = screen.getByRole('heading', { name: '7 жовтня 2026' });
    expect(heading.id).toBe('day-title');
    expect(screen.getByRole('region').getAttribute('aria-labelledby')).toBe('day-title');
  });

  it('is named by the caption when there is no title', () => {
    render(<ListGroup caption="Застосунок">{rows}</ListGroup>);
    const region = screen.getByRole('region', { name: 'Застосунок' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Застосунок' })).toBeTruthy();
  });

  it('takes aria-label, and is a plain div without any name', () => {
    render(<ListGroup aria-label="Що записати?">{rows}</ListGroup>);
    expect(screen.getByRole('region', { name: 'Що записати?' })).toBeTruthy();
    cleanup();
    const { container } = render(
      <ListGroup full className="extra">
        {rows}
      </ListGroup>,
    );
    expect(screen.queryByRole('region')).toBeNull();
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root.classList.contains(cls(groupStyles.full))).toBe(true);
    expect(root.classList.contains('extra')).toBe(true);
  });
});

describe('ListRow', () => {
  const group = (children: ReactNode) => <ListGroup aria-label="Список">{children}</ListGroup>;
  const noop = () => undefined;

  it('is a button with onClick, named by its visible content', () => {
    const onClick = vi.fn();
    render(
      group(
        <ListRow
          icon="food"
          iconTone="acc2"
          title="Їжа"
          sub="Опис або фото"
          value="1 240 ккал"
          onClick={onClick}
          aria-haspopup="dialog"
        />,
      ),
    );
    const button = screen.getByRole('button', { name: 'Їжа Опис або фото 1 240 ккал' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is a link with href that pushes the route and stamps where it came from', () => {
    const { memory } = inRouter(
      group(
        <ListRow
          icon="bell"
          title="Нагадування"
          value="3 увімк."
          valueVariant="soft"
          href="/settings/reminders"
        />,
      ),
    );
    const link = screen.getByRole('link', { name: /^Нагадування/ });
    expect(link.getAttribute('href')).toBe('/settings/reminders');
    expect(link.getAttribute('aria-current')).toBeNull();
    fireEvent.click(link);
    expect(memory.history).toEqual(['/settings', '/settings/reminders']);
    expect(memory.state).toEqual({ legkoFrom: '/settings' });
  });

  it('replaces the entry with `replace` and marks the current row', () => {
    const { memory } = inRouter(
      group(<ListRow title="Цілі" href="/settings/goals" replace current />),
      '/settings/reminders',
    );
    const link = screen.getByRole('link', { name: 'Цілі' });
    expect(link.getAttribute('aria-current')).toBe('page');
    fireEvent.click(link);
    expect(memory.history).toEqual(['/settings/goals']);
  });

  it('is static content without href / onClick', () => {
    render(group(<ListRow title="Вага" value="65,4 кг" />));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('listitem').textContent).toBe('Вага 65,4 кг');
  });

  it('shows the chevron only on interactive rows by default; chevron and meter are decorative', () => {
    const chevrons = (container: HTMLElement) => container.querySelectorAll(`.${cls(rowStyles.chevron)}`);
    const staticRow = render(group(<ListRow title="Вага" />));
    expect(chevrons(staticRow.container)).toHaveLength(0);
    cleanup();

    const button = render(group(<ListRow title="Їжа" meter={{ value: 40, tone: 'acc2' }} onClick={noop} />));
    const [chevron] = chevrons(button.container);
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    const meter = button.container.querySelector(`.${cls(rowStyles.meter)}`);
    expect(meter?.getAttribute('aria-hidden')).toBe('true');
    const action = screen.getByRole('button', { name: 'Їжа' });
    expect(action.contains(meter)).toBe(true);
    // A <button> takes phrasing content only: the meter is spans, like every other part of the row.
    expect(action.querySelector('div')).toBeNull();
    cleanup();

    const logout = render(group(<ListRow title="Вийти" titleTone="accent" chevron={false} onClick={noop} />));
    expect(chevrons(logout.container)).toHaveLength(0);
    cleanup();

    const forced = render(group(<ListRow title="Підказка" chevron />));
    expect(chevrons(forced.container)).toHaveLength(1);
  });

  it('keeps the trailing control outside the row action', () => {
    const onRow = vi.fn();
    const onToggle = vi.fn();
    render(
      group(
        <ListRow
          icon="workout"
          title="Тренування"
          sub="Ще не відмічено"
          chevron={false}
          onClick={onRow}
          trailing={
            <TrainingToggle size="sm" value={null} onChange={onToggle} aria-label="Тренування сьогодні" />
          }
        />,
      ),
    );
    const row = screen.getByRole('button', { name: 'Тренування Ще не відмічено' });
    const yes = screen.getByRole('button', { name: 'Було' });
    expect(row.contains(yes)).toBe(false);
    expect(screen.getByRole('listitem').contains(yes)).toBe(true);
    fireEvent.click(yes);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(true);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('renders children under the row, outside the action', () => {
    render(
      group(
        <ListRow title="Їжа" onClick={noop}>
          <button type="button">Фото 1</button>
        </ListRow>,
      ),
    );
    const row = screen.getByRole('button', { name: 'Їжа' });
    expect(row.contains(screen.getByRole('button', { name: 'Фото 1' }))).toBe(false);
  });

  it('aria-label replaces the name; describeSub adds the sub as the description', () => {
    render(
      group(
        <>
          <ListRow
            title="Їжа"
            sub="Омлет, борщ"
            value="1 880 ккал"
            aria-label="Їжа: 1 880 ккал"
            describeSub
            onClick={noop}
          />
          <ListRow
            title="Нотатки"
            sub="Сон 8 год"
            aria-label="Нотатки"
            aria-describedby="hint"
            describeSub
            onClick={noop}
          />
          <ListRow title="Вага" sub="12 жовтня — 65,4 кг" aria-label="Вага" onClick={noop} />
        </>,
      ),
    );
    const food = screen.getByRole('button', { name: 'Їжа: 1 880 ккал' });
    const foodSub = screen.getByText('Омлет, борщ');
    expect(foodSub.id).not.toBe('');
    expect(food.getAttribute('aria-describedby')).toBe(foodSub.id);

    const notes = screen.getByRole('button', { name: 'Нотатки' });
    expect(notes.getAttribute('aria-describedby')).toBe(`hint ${screen.getByText('Сон 8 год').id}`);

    expect(screen.getByRole('button', { name: 'Вага' }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('a static row reads its aria-label instead of the visible text', () => {
    render(group(<ListRow title="Вага" value="65,4 кг" aria-label="Вага: 65,4 кілограма" />));
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Вага: 65,4 кілограма').className).toBe('visually-hidden');
    expect(within(item).getByText('Вага').getAttribute('aria-hidden')).toBe('true');
    expect(within(item).getByText('65,4 кг').getAttribute('aria-hidden')).toBe('true');
  });

  it('top-aligns the icon only on rows whose sub wraps (`subWrap`), so it stays beside a multi-line title block', () => {
    const top = cls(rowStyles.top);
    render(
      group(
        <>
          <ListRow
            icon="food"
            iconTone="acc2"
            title="Їжа"
            sub={'Сніданок — омлет\nОбід — борщ\nВечеря — салат'}
            subWrap
            value="1 880 ккал"
            onClick={noop}
          >
            <button type="button">Фото 1</button>
          </ListRow>
          <ListRow icon="weight" title="Вага" sub="65,4 кг" onClick={noop} />
          <ListRow icon="notes" title="Нотатки" subWrap onClick={noop} />
          <ListRow icon="measure" title="Заміри" sub="Талія 72 см" subWrap />
        </>,
      ),
    );
    const action = (name: RegExp) => screen.getByRole('button', { name });
    expect(action(/^Їжа/).classList.contains(top)).toBe(true);
    expect(action(/^Вага/).classList.contains(top)).toBe(false);
    // `subWrap` without a sub has nothing to wrap.
    expect(action(/^Нотатки/).classList.contains(top)).toBe(false);
    // Static rows too (the class sits on the action element, whatever it renders as).
    const measures = screen.getByText('Заміри').parentElement as HTMLElement;
    expect(measures.classList.contains(cls(rowStyles.action))).toBe(true);
    expect(measures.classList.contains(top)).toBe(true);
  });

  it('disabled blocks onClick', () => {
    const onClick = vi.fn();
    render(group(<ListRow title="Їжа" onClick={onClick} disabled />));
    const button = screen.getByRole('button', { name: 'Їжа' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies tones to the sub and the value, and modifier classes for size, icon and trailing', () => {
    render(
      group(
        <ListRow
          size="lg"
          icon="weight"
          title="Вага"
          sub="Пропущено · 12 жовтня"
          subTone="acc"
          value="1 820"
          valueTone="acc"
          onClick={noop}
          trailing={<span>T</span>}
        />,
      ),
    );
    const item = screen.getByRole('listitem');
    for (const name of [rowStyles.item, rowStyles.lg, rowStyles.withIcon, rowStyles.withTrailing]) {
      expect(item.classList.contains(cls(name))).toBe(true);
    }
    expect(screen.getByText('Пропущено · 12 жовтня').className).toBe(cls(toneStyles.acc));
    expect(screen.getByText('1 820').className).toBe(cls(toneStyles.acc));
    expect(item.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});

describe('ScreenHeader', () => {
  const back = { href: '/settings', label: 'Налаштування' };

  it('keeps the plain header: subtitle, h1 and the right slot', () => {
    render(<ScreenHeader subtitle="Середа, 14 жовтня" title="Доброго ранку" right={<span>Л</span>} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Доброго ранку' });
    expect(h1.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).not.toBe(h1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('has a back link «Назад: …» to the parent', () => {
    inRouter(<ScreenHeader title="Нагадування" back={back} />, '/settings/reminders');
    const link = screen.getByRole('link', { name: 'Назад: Налаштування' });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(link.textContent).toBe('Налаштування');
    expect(screen.getByRole('heading', { level: 1, name: 'Нагадування' })).toBeTruthy();
  });

  it('back pops the history entry when the page was opened from the list', () => {
    window.history.replaceState({ legkoFrom: '/settings' }, '');
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = inRouter(<ScreenHeader title="Нагадування" back={back} />, '/settings/reminders');
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Налаштування' }));
    expect(historyBack).toHaveBeenCalledOnce();
    expect(memory.history).toEqual(['/settings/reminders']);
  });

  it('back replace-navigates to the parent after a deep link', () => {
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = inRouter(<ScreenHeader title="Нагадування" back={back} />, '/settings/reminders');
    fireEvent.click(screen.getByRole('link', { name: 'Назад: Налаштування' }));
    expect(historyBack).not.toHaveBeenCalled();
    expect(memory.history).toEqual(['/settings']);
  });

  it('focusTitle focuses the h1 on mount', () => {
    render(<ScreenHeader title="Цілі" focusTitle />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Цілі' });
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h1);
  });
});

describe('StatStrip', () => {
  const items = [
    { label: 'Тренувань', value: '2' },
    { label: 'Сер. цього тижня', value: '1 795', unit: 'ккал', tone: 'acc2' as const },
    { label: 'Сер. цього місяця', value: '—', unit: 'ккал', tone: 'acc' as const },
  ];

  it('is a dl of dt + dd pairs, the label first in the DOM', () => {
    const { container } = render(<StatStrip items={items} aria-label="Харчування" />);
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl.getAttribute('aria-label')).toBe('Харчування');
    const cells = [...dl.children];
    expect(cells.map((c) => c.tagName)).toEqual(['DIV', 'DIV', 'DIV']);
    expect(cells.map((c) => [...c.children].map((e) => e.tagName))).toEqual([
      ['DT', 'DD'],
      ['DT', 'DD'],
      ['DT', 'DD'],
    ]);
    expect(cells[0]?.textContent).toBe('Тренувань2');
    expect(cells[1]?.textContent).toBe('Сер. цього тижня1 795ккал');
    expect(within(cells[1] as HTMLElement).getByText('ккал').tagName).toBe('SPAN');
  });

  it('colours values by tone, and «—» always faint', () => {
    const { container } = render(<StatStrip items={items} />);
    const values = [...container.querySelectorAll('dd')];
    expect(values[0]?.className).toBe(cls(stripStyles.value));
    expect(values[1]?.classList.contains(cls(toneStyles.acc2))).toBe(true);
    expect(values[2]?.classList.contains(cls(toneStyles.faint))).toBe(true);
    expect(values[2]?.classList.contains(cls(toneStyles.acc))).toBe(false);
  });

  it('picks phone and desktop column classes', () => {
    const { container, rerender } = render(<StatStrip items={items} />);
    const dl = () => container.querySelector('dl') as HTMLElement;
    expect(dl().classList.contains(cls(stripStyles.c3))).toBe(true);
    expect(dl().classList.contains(cls(stripStyles.d3))).toBe(true);
    rerender(<StatStrip items={[...items, { label: 'Ще', value: '1' }, { label: 'І ще', value: '2' }]} />);
    expect(dl().classList.contains(cls(stripStyles.c4))).toBe(true);
    rerender(<StatStrip items={items} columns={2} desktopColumns={4} className="mine" />);
    expect(dl().classList.contains(cls(stripStyles.c2))).toBe(true);
    expect(dl().classList.contains(cls(stripStyles.d4))).toBe(true);
    expect(dl().classList.contains('mine')).toBe(true);
  });
});
