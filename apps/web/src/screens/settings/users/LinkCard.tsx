import { useEffect, useId, useRef } from 'react';
import { ui } from '@/store/ui';
import { Button, Card, Icon } from '@/ui';
import f from '../forms.module.css';
import { LINK_COPY, linkExpiryLine, shareData, type LinkPurpose } from './usersModel';
import s from './LinkCard.module.css';

export interface LinkCardProps {
  purpose: LinkPurpose;
  /** The link's path from the server (`/invite#<token>`); shown with this page's origin. */
  path: string;
  expiresAt: number;
  /** «Готово»: the link is gone from the screen for good (it is never shown again). */
  onDone: () => void;
  /** Level of the card title: `h2` on the phone page, `h3` in the desktop pane and in the user sheet. */
  headingLevel: 'h2' | 'h3';
}

const MANUAL_MS = 3200;

/** The share sheet was closed without sharing (not an error). */
const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/**
 * A fresh one-time link (docs/multi-user.md §9.6, LinkCard): the full URL in a read-only field, «Скопіювати» (and
 * «Поділитися» where the browser can share), when it stops working, and «Готово». The token is shown only now.
 *
 * «Скопійовано» appears only once the clipboard really took it. Without a clipboard, or when it refuses, the link is
 * selected in the field instead (`setSelectionRange`: iOS ignores `select()` on read-only inputs) for a manual copy.
 * The card's title takes the focus when it appears, so a screen reader announces it.
 */
export function LinkCard({ purpose, path, expiresAt, onDone, headingLevel: Heading }: LinkCardProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = new URL(path, window.location.origin).href;
  const canShare = typeof navigator.share === 'function';

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  };

  const copyManually = () => {
    selectLink();
    ui.flash(LINK_COPY.selected, MANUAL_MS);
  };

  const copy = async () => {
    const clipboard = typeof navigator.clipboard?.writeText === 'function' ? navigator.clipboard : null;
    if (!clipboard) {
      copyManually();
      return;
    }
    try {
      await clipboard.writeText(url);
      ui.flash(LINK_COPY.copied);
    } catch {
      copyManually();
    }
  };

  const share = async () => {
    try {
      await navigator.share(shareData(purpose, url, expiresAt));
    } catch (err) {
      if (!isAbort(err)) copyManually();
    }
  };

  return (
    <Card as="section" aria-labelledby={titleId} gap={12} className={s.card}>
      <div className={s.head}>
        <span className={s.icon} aria-hidden="true">
          <Icon name={purpose === 'invite' ? 'link' : 'key'} size={20} />
        </span>
        <Heading ref={titleRef} id={titleId} tabIndex={-1} className={s.title}>
          {purpose === 'invite' ? LINK_COPY.inviteTitle : LINK_COPY.resetTitle}
        </Heading>
      </div>
      <input
        ref={inputRef}
        className={`${f.input} ${s.url}`}
        type="text"
        readOnly
        value={url}
        aria-label={LINK_COPY.urlLabel}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.length)}
      />
      <div className={canShare ? f.pair : f.actions}>
        {canShare && (
          <Button variant="outline" onClick={() => void share()}>
            {LINK_COPY.share}
          </Button>
        )}
        <Button onClick={() => void copy()}>{LINK_COPY.copy}</Button>
      </div>
      <p className={f.note}>{linkExpiryLine(purpose, expiresAt)}</p>
      <div className={s.foot}>
        <p className={f.note}>{LINK_COPY.onlyNow}</p>
        <Button variant="outline" size="sm" onClick={onDone}>
          {LINK_COPY.done}
        </Button>
      </div>
    </Card>
  );
}
