import { f0 } from '@legko/shared';
import { useId, type Ref } from 'react';
import { Button, Card, CardHeader } from '@/ui';
import { draftsTotal, emptyEstimateComment, pluralUk, remainingHint, type DraftItem } from './model';
import s from './EstimateCard.module.css';

export interface EstimateCardProps {
  drafts: readonly DraftItem[];
  comment: string;
  /** The estimate came from a photo (changes the advice when nothing was found). */
  photo?: boolean;
  /** Thumbnail (`data:` URL) when the estimate came from a photo. */
  preview: string | null;
  /** Estimates left today (hint shown when ≤ 10). */
  remaining: number | null;
  /** The «Оцінка калорій» title (focusable with tabIndex −1): focus lands here when the result arrives. */
  titleRef?: Ref<HTMLSpanElement>;
  onEditKcal: (itemId: string, kcalText: string) => void;
  onRemove: (itemId: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  /** Back to the composer (shown when nothing was recognised). */
  onRetry: () => void;
}

/** Itemised estimate she can adjust before adding it to the day. */
export function EstimateCard({
  drafts,
  comment,
  photo = false,
  preview,
  remaining,
  titleRef,
  onEditKcal,
  onRemove,
  onAdd,
  onCancel,
  onRetry,
}: EstimateCardProps) {
  const titleId = useId();
  const total = draftsTotal(drafts);
  const hint = remainingHint(remaining);
  const empty = drafts.length === 0;
  const thumb = preview ? <img className={s.thumb} src={preview} alt="Фото їжі" /> : null;

  return (
    <Card as="section" gap={14} className={s.card} aria-labelledby={titleId}>
      <CardHeader
        as="h3"
        size="sm"
        titleId={titleId}
        title={
          <span ref={titleRef} tabIndex={-1} className={s.title}>
            Оцінка калорій
          </span>
        }
        subtitle={
          empty ? 'Нічого не знайдено' : `${drafts.length} ${pluralUk(drafts.length, 'позиція', 'позиції', 'позицій')} · можна виправити`
        }
        right={thumb}
      />

      {!empty && (
        <ul className={s.items}>
          {drafts.map((d) => (
            <EstimateRow key={d.id} item={d} onEditKcal={onEditKcal} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {!empty && (
        <div className={s.total}>
          <span className={s.totalLabel}>Разом</span>
          <span className={s.totalValue} aria-live="polite">
            {f0(total)} <span className={s.unit}>ккал</span>
          </span>
        </div>
      )}

      {(comment || empty) && (
        <p className={s.comment}>{comment || emptyEstimateComment(photo)}</p>
      )}
      {hint && <p className={s.remaining}>{hint}</p>}

      <div className={s.buttons}>
        {empty ? (
          <Button className={s.primary} variant="outline" onClick={onRetry}>
            Спробувати ще
          </Button>
        ) : (
          <Button className={s.primary} onClick={onAdd}>
            Додати {f0(total)} ккал
          </Button>
        )}
        <Button variant="ghost" className={s.cancel} onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </Card>
  );
}

interface EstimateRowProps {
  item: DraftItem;
  onEditKcal: (itemId: string, kcalText: string) => void;
  onRemove: (itemId: string) => void;
}

function EstimateRow({ item, onEditKcal, onRemove }: EstimateRowProps) {
  const nameId = useId();
  const unitId = useId();
  return (
    <li className={s.item}>
      <div className={s.itemText}>
        <span id={nameId} className={s.name}>
          {item.name}
        </span>
        {item.portion && <span className={s.portion}>{item.portion}</span>}
      </div>
      <label className={s.kcal}>
        <input
          className={s.kcalInput}
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={5}
          value={item.kcalText}
          placeholder="0"
          aria-labelledby={`${nameId} ${unitId}`}
          onChange={(e) => onEditKcal(item.id, e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            // «Готово» on the keyboard just closes it; never submits anything around the card.
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <span id={unitId} className={s.unit}>
          ккал
        </span>
      </label>
      <button
        type="button"
        className={s.remove}
        aria-label={`Прибрати «${item.name}»`}
        onClick={() => onRemove(item.id)}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
}

export interface EstimateLoadingProps {
  /** The estimate is for a photo (shows its thumbnail, or a placeholder while it is prepared). */
  photo: boolean;
  preview: string | null;
  onCancel: () => void;
  /** «Скасувати»: focus waits here while the model answers. */
  cancelRef?: Ref<HTMLButtonElement>;
}

/**
 * «Рахую калорії…» placeholder while the photo is prepared and the model answers. Not a live
 * region itself (one inserted with its text already in it is often not read): FoodAssist's
 * persistent status region announces the progress.
 */
export function EstimateLoading({ photo, preview, onCancel, cancelRef }: EstimateLoadingProps) {
  return (
    <div className={s.loading}>
      {preview ? (
        <img className={s.thumb} src={preview} alt="" />
      ) : (
        <span className={photo ? s.thumbSkeleton : s.spark} aria-hidden="true">
          {photo ? null : '✨'}
        </span>
      )}
      <div className={s.loadingBody}>
        <span className={s.loadingTitle}>Рахую калорії…</span>
        <span className={s.bar} aria-hidden="true" />
        <span className={`${s.bar} ${s.barShort}`} aria-hidden="true" />
      </div>
      <Button ref={cancelRef} variant="ghost" className={s.loadingCancel} onClick={onCancel}>
        Скасувати
      </Button>
    </div>
  );
}
