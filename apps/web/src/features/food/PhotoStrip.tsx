import { photoThumbUrl } from '@legko/shared';
import { useRef, useState } from 'react';
import { cx } from '@/ui';
import { PhotoViewer } from './PhotoViewer';
import s from './PhotoStrip.module.css';

export interface PhotoStripProps {
  ids: readonly string[];
  /** 'sm' = 48px thumbs (calendar detail), 'md' = 64px (day sheet). */
  size?: 'sm' | 'md';
  /** Shows a remove button on each thumb (day sheet). */
  onRemove?: (id: string) => void;
}

/** Row of food photo thumbnails (photo diary); tap opens the full-screen viewer. */
export function PhotoStrip({ ids, size = 'md', onRemove }: PhotoStripProps) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const thumbs = useRef(new Map<string, HTMLButtonElement>());

  if (!ids.length) return null;
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
      <ul className={cx(s.strip, s[size], onRemove && s.removable)}>
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
              <button type="button" className={s.remove} aria-label="Видалити фото" onClick={() => onRemove(id)}>
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
