/**
 * Page scroll lock that also works on iOS Safari, where `overflow: hidden` on <body> is not enough:
 * the body is pinned with `position: fixed` at the current offset and the offset is restored on release.
 * Reference-counted so nested locks (e.g. a sheet opened while another is closing) behave.
 */
let locks = 0;
let savedY = 0;

const LOCK_CLASS = 'scroll-locked';

function apply(): void {
  savedY = window.scrollY;
  const { body, documentElement } = document;
  documentElement.classList.add(LOCK_CLASS);
  body.style.position = 'fixed';
  body.style.top = `-${savedY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
}

function restore(): void {
  const { body, documentElement } = document;
  documentElement.classList.remove(LOCK_CLASS);
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  window.scrollTo(0, savedY);
}

/** Locks page scroll; returns an idempotent release function. */
export function lockScroll(): () => void {
  if (locks === 0) apply();
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) restore();
  };
}
