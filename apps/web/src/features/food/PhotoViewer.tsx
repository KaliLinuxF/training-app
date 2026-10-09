import { photoThumbUrl, photoUrl } from '@legko/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/ui';
import s from './PhotoViewer.module.css';

export interface PhotoViewerProps {
  ids: readonly string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Give focus back to whatever had it before opening (default). Off when the opener restores focus itself. */
  restoreFocus?: boolean;
}

/** Horizontal swipe distance that flips to the neighbour photo, px. */
const SWIPE_X = 60;
/** Downward swipe distance that closes the viewer, px. */
const SWIPE_DOWN = 100;

export type SwipeResult = 'prev' | 'next' | 'close' | null;

/** Interprets a finished drag: mostly horizontal → neighbour photo, mostly downward → close. */
export function swipeResult(dx: number, dy: number): SwipeResult {
  if (Math.abs(dx) >= SWIPE_X && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'next' : 'prev';
  if (dy >= SWIPE_DOWN && dy > Math.abs(dx)) return 'close';
  return null;
}

/** Full-screen photo viewer (portal): black backdrop, contained image, ✕ / Escape, swipe and ← → between photos. */
export function PhotoViewer(props: PhotoViewerProps) {
  return createPortal(<ViewerFrame {...props} />, document.body);
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
}

function ViewerFrame({ ids, index, onIndexChange, onClose, restoreFocus = true }: PhotoViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  const count = ids.length;
  const id = ids[index] ?? ids[0] ?? '';
  const canPrev = index > 0;
  const canNext = index < count - 1;
  const fullFailed = failed.has(`f:${id}`);
  const thumbFailed = failed.has(`t:${id}`);
  const markFailed = (key: string) => setFailed((prev) => new Set(prev).add(key));

  const go = (delta: -1 | 1) => {
    const next = index + delta;
    if (next >= 0 && next < count) onIndexChange(next);
  };

  const onWindowKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.isComposing) return;
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.key !== 'Escape' && delta === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (delta === 0) onClose();
    else go(delta);
  });

  // Focus the close button while open; optionally give focus back afterwards.
  const restore = useRef(restoreFocus);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const shouldRestore = restore.current;
    return () => {
      if (shouldRestore && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Capture phase on window: runs before the day sheet's own Escape handler, which must not fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onWindowKey(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Keep the page behind still (wheel on desktop, rubber-band scrolling on iOS).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const block = (e: Event) => e.preventDefault();
    root.addEventListener('wheel', block, { passive: false });
    root.addEventListener('touchmove', block, { passive: false });
    return () => {
      root.removeEventListener('wheel', block);
      root.removeEventListener('touchmove', block);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keep keys away from a sheet underneath (React events bubble through portals).
    e.stopPropagation();
    if (e.key !== 'Tab') return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setOffset({ dx: e.clientX - d.x, dy: Math.max(0, e.clientY - d.y) });
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setOffset(null);
    if (e.type === 'pointercancel') return;
    const result = swipeResult(e.clientX - d.x, e.clientY - d.y);
    if (result === 'close') onClose();
    else if (result === 'prev') go(-1);
    else if (result === 'next') go(1);
  };

  const imageStyle = offset
    ? {
        transform: `translate3d(${offset.dx}px, ${offset.dy}px, 0)`,
        opacity: Math.max(0.4, 1 - offset.dy / 400),
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={s.viewer}
      role="dialog"
      aria-modal="true"
      aria-label="Фото їжі"
      onKeyDown={onKeyDown}
    >
      <div className={s.top}>
        <button ref={closeRef} type="button" className={s.round} aria-label="Закрити" onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div
        className={s.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {fullFailed && thumbFailed ? (
          <p className={s.unavailable}>Фото недоступне</p>
        ) : (
          <div className={cx(s.frame, offset && s.dragging)} style={imageStyle}>
            {/* The cached thumbnail shows instantly; the full photo covers it once loaded (or stands in for it). */}
            {!thumbFailed && (
              <img
                key={`t-${id}`}
                className={s.image}
                src={photoThumbUrl(id)}
                alt={fullFailed ? 'Фото їжі' : ''}
                aria-hidden={fullFailed ? undefined : true}
                draggable={false}
                onError={() => markFailed(`t:${id}`)}
              />
            )}
            {!fullFailed && (
              <img
                key={id}
                className={s.image}
                src={photoUrl(id)}
                alt="Фото їжі"
                draggable={false}
                onError={() => markFailed(`f:${id}`)}
              />
            )}
          </div>
        )}
      </div>

      {count > 1 && (
        <div className={s.bottom}>
          <button
            type="button"
            className={s.round}
            aria-label="Попереднє фото"
            disabled={!canPrev}
            onClick={() => go(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className={s.counter} aria-live="polite">
            {index + 1} / {count}
          </span>
          <button
            type="button"
            className={s.round}
            aria-label="Наступне фото"
            disabled={!canNext}
            onClick={() => go(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
    </div>
  );
}
