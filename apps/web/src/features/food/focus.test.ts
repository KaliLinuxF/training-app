import { afterEach, describe, expect, it } from 'vitest';
import { focusFirst, focusIsAround, neighbourControls } from './focus';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('neighbourControls', () => {
  it('lists the buttons after / before a node within its dialog, nearest first, skipping unusable ones', () => {
    mount(`
      <button id="outside">outside</button>
      <div role="dialog">
        <button id="b1">1</button>
        <textarea id="text"></textarea>
        <button id="b2">2</button>
        <ul id="strip"><li><button id="inner">x</button></li></ul>
        <button id="disabled" disabled>d</button>
        <input id="file" type="file" tabindex="-1" aria-hidden="true">
        <div aria-hidden="true"><button id="hidden">h</button></div>
        <button id="minus" tabindex="-1">m</button>
        <button id="a1">a</button>
        <a id="link" href="#x">link</a>
      </div>`);
    const strip = byId('strip');
    expect(neighbourControls(strip, 'after').map((el) => el.id)).toEqual(['a1', 'link']);
    // Text fields are skipped (they would pop up the iPhone keyboard).
    expect(neighbourControls(strip, 'before').map((el) => el.id)).toEqual(['b2', 'b1']);
  });
});

describe('focusFirst', () => {
  it('focuses the first candidate that is attached and focusable', () => {
    mount('<button id="off" disabled>off</button><button id="on">on</button>');
    const gone = document.createElement('button');
    expect(focusFirst([null, gone, byId('off'), byId('on')])).toBe(true);
    expect(document.activeElement).toBe(byId('on'));
    expect(focusFirst([undefined, gone])).toBe(false);
  });
});

describe('focusIsAround', () => {
  it('true inside the block, on an ancestor (Safari focuses the dialog) or on <body>; false in another control', () => {
    mount(`
      <div role="dialog" id="panel" tabindex="-1">
        <div id="root"><button id="inside">in</button></div>
        <input id="other">
      </div>`);
    const root = byId('root');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusIsAround(root)).toBe(true);
    byId('inside').focus();
    expect(focusIsAround(root)).toBe(true);
    byId('panel').focus();
    expect(focusIsAround(root)).toBe(true);
    byId('other').focus();
    expect(focusIsAround(root)).toBe(false);
  });
});
