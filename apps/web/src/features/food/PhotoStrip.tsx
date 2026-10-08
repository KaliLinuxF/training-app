import { photoThumbUrl } from '@legko/shared';

export interface PhotoStripProps {
  ids: readonly string[];
  /** 'sm' = 48px thumbs (calendar detail), 'md' = 64px (day sheet). */
  size?: 'sm' | 'md';
  /** Shows a remove button on each thumb (day sheet). */
  onRemove?: (id: string) => void;
}

/** Row of food photo thumbnails; tap opens a full-screen viewer. Phase stub — refined by the food-web task. */
export function PhotoStrip({ ids, size = 'md' }: PhotoStripProps) {
  if (!ids.length) return null;
  const px = size === 'sm' ? 48 : 64;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {ids.map((id) => (
        <img key={id} src={photoThumbUrl(id)} alt="Фото їжі" width={px} height={px} style={{ borderRadius: 12, objectFit: 'cover' }} />
      ))}
    </div>
  );
}
