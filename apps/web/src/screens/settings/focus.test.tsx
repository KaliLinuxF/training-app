import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canTakeFocus,
  focusedControl,
  focusFirst,
  focusIsLost,
  useRefocus,
  type FocusCandidate,
} from './focus';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('focusFirst', () => {
  it('skips what cannot take the focus: missing, disabled (also via a fieldset), removed, inert, <body>', () => {
    mount(`
      <button id="off" disabled>off</button>
      <fieldset disabled><button id="inFieldset">in</button></fieldset>
      <div inert><button id="inert">inert</button></div>
      <button id="ok">ok</button>
    `);
    const removed = document.createElement('button');
    const candidates: FocusCandidate[] = [
      null,
      undefined,
      'missing',
      () => null,
      byId('off'),
      'inFieldset',
      byId('inert'),
      removed,
      document.body,
      { current: null },
      { current: byId('ok') },
    ];
    expect(focusFirst(candidates)).toBe(byId('ok'));
    expect(document.activeElement).toBe(byId('ok'));
  });

  it('makes a heading focusable for scripts only (tabindex -1), and leaves a button’s own tab stop alone', () => {
    mount('<h2 id="title">Пароль</h2><button id="save">Зберегти</button>');
    expect(focusFirst(['title'])).toBe(byId('title'));
    expect(byId('title').getAttribute('tabindex')).toBe('-1');
    expect(focusFirst([() => byId('save')])).toBe(byId('save'));
    expect(byId('save').hasAttribute('tabindex')).toBe(false);
  });

  it('returns null and moves nothing when no candidate can take it', () => {
    mount('<input id="field" /><button id="off" disabled>off</button>');
    byId('field').focus();
    expect(focusFirst(['off', 'missing'])).toBeNull();
    expect(document.activeElement).toBe(byId('field'));
  });
});

describe('focusIsLost / focusedControl / canTakeFocus', () => {
  it('is lost on <body>, on a removed element and on a disabled one — not on a live control', () => {
    mount('<button id="a">a</button>');
    expect(focusIsLost()).toBe(true);
    expect(focusedControl()).toBeNull();
    const a = byId('a') as HTMLButtonElement;
    a.focus();
    expect(focusIsLost()).toBe(false);
    expect(focusedControl()).toBe(a);
    a.disabled = true;
    expect(focusIsLost()).toBe(true);
    a.disabled = false;
    a.focus();
    a.remove();
    expect(focusIsLost()).toBe(true);
    expect(canTakeFocus(a)).toBe(false);
  });
});

describe('useRefocus', () => {
  /** A button that is disabled while «busy», like the cards' submit buttons. */
  function Card({ always = false }: { always?: boolean }) {
    const [busy, setBusy] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    const refocus = useRefocus();
    return (
      <>
        <h2 id="title">Title</h2>
        <button ref={ref} disabled={busy} onClick={() => setBusy(true)}>
          Save
        </button>
        <button
          onClick={() => {
            setBusy(false);
            refocus([ref, 'title'], { always });
          }}
        >
          Done
        </button>
        <input aria-label="elsewhere" />
      </>
    );
  }

  it('focuses the first candidate after the render that enabled it, only when the focus is lost', () => {
    render(<Card />);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    save.focus();
    fireEvent.click(save);
    expect(save.disabled).toBe(true);
    // A browser drops the focus of a control that gets disabled; jsdom keeps it there (and ignores `blur()`), so it
    // is parked on a stand-in that goes away.
    act(() => {
      const standIn = document.createElement('input');
      document.body.append(standIn);
      standIn.focus();
      standIn.remove();
    });
    expect(focusIsLost()).toBe(true);
    // The click on «Done» does not move the focus in jsdom.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.activeElement).toBe(save);
  });

  it('leaves the focus where it is when it is not lost, unless `always`', () => {
    render(<Card />);
    const elsewhere = screen.getByRole('textbox', { name: 'elsewhere' });
    elsewhere.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.activeElement).toBe(elsewhere);
    cleanup();

    render(<Card always />);
    screen.getByRole('textbox', { name: 'elsewhere' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });
});
