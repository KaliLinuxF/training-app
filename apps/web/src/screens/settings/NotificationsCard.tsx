import { useId, useState } from 'react';
import type { ISODate } from '@legko/shared';
import { disablePush, enablePush, sendTestPush } from '@/lib/push';
import { ui } from '@/store/ui';
import { Button, Card } from '@/ui';
import { errorText, notifView, NOTIF_TOASTS } from './model';
import type { PushStatusState } from './usePushStatus';
import s from './NotificationsCard.module.css';

const ERROR_MS = 3200;

export interface NotificationsCardProps {
  today: ISODate;
  /** This device's push status, owned by SettingsScreen (the list's «Нагадування» badge reads the same state). */
  push: PushStatusState;
  /** `h2` under a page <h1> (phone), `h3` under the desktop pane's <h2>. */
  headingLevel?: 'h2' | 'h3';
}

/** Dark «Сповіщення на телефон» panel: permission / subscription state of this device + CTA. */
export function NotificationsCard({ today, push, headingLevel: Heading = 'h2' }: NotificationsCardProps) {
  const titleId = useId();
  const { status, setStatus, refresh } = push;
  const [busy, setBusy] = useState(false);
  const view = notifView(status, busy);

  const enable = () => {
    // Called straight from the tap, before any await: iOS only shows the permission prompt
    // while it is handling the user gesture.
    const pending = enablePush();
    setBusy(true);
    pending
      .then(
        (next) => {
          setStatus(next);
          if (next === 'enabled') ui.flash(NOTIF_TOASTS.enabled);
          else if (next === 'denied') ui.flash(NOTIF_TOASTS.denied, ERROR_MS);
        },
        (err: unknown) => {
          console.warn('[legko] enabling push failed', err);
          ui.flash(errorText(err, NOTIF_TOASTS.enableFailed), ERROR_MS);
          refresh();
        },
      )
      .finally(() => setBusy(false));
  };

  const test = () => {
    setBusy(true);
    sendTestPush()
      .then(
        (sent) => {
          if (sent > 0) ui.flash(NOTIF_TOASTS.testSent);
          else {
            ui.flash(NOTIF_TOASTS.testNobody, ERROR_MS);
            refresh();
          }
        },
        (err: unknown) => ui.flash(errorText(err, NOTIF_TOASTS.testFailed), ERROR_MS),
      )
      .finally(() => setBusy(false));
  };

  const turnOff = () => {
    setBusy(true);
    disablePush()
      .then(
        () => ui.flash(NOTIF_TOASTS.disabled),
        (err: unknown) => ui.flash(errorText(err, NOTIF_TOASTS.disableFailed), ERROR_MS),
      )
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const onCta = () => {
    if (view.action === 'enable') enable();
    else if (view.action === 'test') test();
    else if (view.action === 'install') ui.openSheet(today, 'install');
  };

  return (
    <Card variant="solid" row full as="section" aria-labelledby={titleId} className={s.panel}>
      <div className={s.text}>
        <Heading id={titleId} className={s.title}>
          Сповіщення на телефон
        </Heading>
        <p className={s.sub} aria-live="polite">
          {view.sub}
        </p>
        {view.canTurnOff && (
          <button type="button" className={s.turnOff} onClick={turnOff} disabled={busy}>
            Вимкнути на цьому пристрої
          </button>
        )}
      </div>
      <Button variant="accent" size="sm" className={s.cta} onClick={onCta} disabled={view.disabled}>
        {view.cta}
      </Button>
    </Card>
  );
}
