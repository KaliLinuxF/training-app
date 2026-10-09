import { photoThumbUrl } from '@legko/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from '@/ui';
import { focusFirst, neighbourControls } from './focus';
import { PhotoViewer } from './PhotoViewer';
import s from './PhotoStrip.module.css';

export interface PhotoStripProps {
  ids: readonly string[];
  /** 'sm' = 48px thumbs (calendar detail), 'md' = 64px (day sheet). */
  size?: 'sm' | 'md';
  /** Shows a remove button on each thumb (day sheet). */
  onRemove?: (id: string) => void;
}

/** Where focus goes after a photo is removed (resolved once the parent re-renders the strip). */
interface AfterRemove {
  id: string;
  index: number;
  /** Nearest control after the strip, for when the last photo is gone (and the strip with it). */
  fallback: HTMLElement[];
}

/** Row of food photo thumbnails (photo diary); tap opens the full-screen viewer. */
export function PhotoStrip({ ids, size = 'md', onRemove }: PhotoStripProps) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const thumbs = useRef(new Map<string, HTMLButtonElement>());
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const stripRef = useRef<HTMLUListElement>(null);
  const afterRemove = useRef<AfterRemove | null>(null);

  // The removed photo's ✕ took focus with it: move to the next photo's ✕ (or the previous one),
  // and when the strip is empty, to the next control after it — never to <body>.
  useLayoutEffect(() => {
    const pending = afterRemove.current;
    if (!pending) return;
    afterRemove.current = null;
    if (ids.includes(pending.id)) return;
    const next = ids[pending.index] ?? ids[pending.index - 1];
    focusFirst(next ? [removeButtons.current.get(next)] : pending.fallback);
  });

  if (!ids.length) return null;

  const remove = (id: string, index: number) => {
    if (!onRemove) return;
    const fallback = stripRef.current ? neighbourControls(stripRef.current, 'after') : [];
    afterRemove.current = { id, index, fallback };
    onRemove(id);
  };
  // A photo removed while the viewer is open: stay within the remaining ones.
  const viewerIndex = openAt === null ? null : Math.min(openAt, ids.length - 1);
  const px = size === 'sm' ? 48 : 64;

  // Focus lands on the thumbnail of the photo she was looking at (Safari does not focus tapped buttons).
  const closeViewer = () => {
    const id = viewerIndex === null ? undefined : ids[viewerIndex];
    setOpenAt(null);
    if (id) thumbs.current.get(id)?.focus({ preventScroll: true });
  };

  return (
    <>
      <ul ref={stripRef} className={cx(s.strip, s[size], onRemove && s.removable)}>
        {ids.map((id, i) => (
          <li key={id} className={s.cell}>
            <button
              ref={(el) => {
                if (el) thumbs.current.set(id, el);
                else thumbs.current.delete(id);
              }}
              type="button"
              className={s.thumb}
              aria-haspopup="dialog"
              aria-label={broken.has(id) ? 'Фото їжі (не вдалося завантажити)' : undefined}
              onClick={() => setOpenAt(i)}
            >
              {broken.has(id) ? (
                <BrokenIcon />
              ) : (
                <img
                  className={s.img}
                  src={photoThumbUrl(id)}
                  alt="Фото їжі"
                  width={px}
                  height={px}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={() => setBroken((prev) => new Set(prev).add(id))}
                />
              )}
            </button>
            {onRemove && (
              <button
                ref={(el) => {
                  if (el) removeButtons.current.set(id, el);
                  else removeButtons.current.delete(id);
                }}
                type="button"
                className={s.remove}
                aria-label="Видалити фото"
                onClick={() => remove(id, i)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {viewerIndex !== null && (
        <PhotoViewer
          ids={ids}
          index={viewerIndex}
          onIndexChange={setOpenAt}
          onClose={closeViewer}
          restoreFocus={false}
        />
      )}
    </>
  );
}

/** Placeholder for a thumbnail that failed to load: a picture outline with a slash. */
function BrokenIcon() {
  return (
    <svg className={s.broken} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="m7 15 3.2-3.2 2.3 2.3 1.8-1.8L17 15" />
      <path d="M4 4l16 16" />
    </svg>
  );
}
