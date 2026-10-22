/** Building blocks of the one-time link pages (`/invite`, `/reset`): layout, unusable link, sign-out first, «Готово». */
import { linkPath, type LinkKind } from '@legko/shared';
import { useState, type ReactNode } from 'react';
import { authActions } from '../../auth/auth';
import { authEnv } from '../../auth/env';
import { clearLinkToken } from '../../auth/linkToken';
import { isIOS, isStandalone } from '../../lib/platform';
import { InstallSteps } from '../../sheets/install/InstallSheet';
import { ui } from '../../store/ui';
import { ASK_ADMIN, LINK_INVALID_TITLE } from './loginErrors';
import s from './LoginScreen.module.css';
import { LogoMark } from './LogoMark';

/** iPhone / iPad Safari (not the home-screen app): links open here, in storage separate from the installed app (D29). */
export const inIosSafari = (): boolean => isIOS() && !isStandalone();

export const COPY_LINK = {
  note: 'Легко вже на початковому екрані? Скопіюй посилання й встав його там: «Маю посилання».',
  button: 'Скопіювати посилання',
  copied: 'Посилання скопійовано',
  failed: 'Не вдалося скопіювати. Виділи посилання й скопіюй його:',
} as const;

/** Paper page with the «Л» mark, a title and an optional subtitle (as the login screen). */
export function AuthPage({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className={s.page}>
      <div className={s.column}>
        <header className={s.brand}>
          <LogoMark className={s.logo} />
          <h1 className={s.title}>{title}</h1>
          {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

/** Leaves a link page for the app (or its login screen); the link is forgotten. */
export function leaveLinkPage(): void {
  clearLinkToken();
  authEnv().replace('/');
}

/** «Посилання не працює»: what went wrong, the advice, and the way into the app. */
export function LinkInvalid({ text, askAdmin, signedIn }: { text: string; askAdmin: boolean; signedIn: boolean }) {
  return (
    <AuthPage title={LINK_INVALID_TITLE}>
      <div className={s.card}>
        <div className={s.copy}>
          <p className={s.text}>{text}</p>
          {askAdmin ? <p className={s.text}>{ASK_ADMIN}</p> : null}
        </div>
        <button type="button" className={s.submit} onClick={leaveLinkPage}>
          {signedIn ? 'Відкрити Легко' : 'Увійти'}
        </button>
      </div>
    </AuthPage>
  );
}

/** The link could not be checked (no connection, too many attempts): say so and offer another try. */
export function LinkRetry({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <AuthPage title={title}>
      <div className={s.card}>
        <p className={s.error} role="alert">
          {message}
        </p>
        <button type="button" className={s.submit} onClick={onRetry}>
          Спробувати ще раз
        </button>
      </div>
    </AuthPage>
  );
}

/** Someone is signed in on this device: sign out first (the link is kept for after the reload), or go back. */
export function LinkInterstitial({ title, text, path }: { title: string; text: string; path: string }) {
  const [busy, setBusy] = useState(false);
  const signOut = () => {
    setBusy(true);
    authActions.logout(path).then(
      (done) => {
        if (!done) setBusy(false);
      },
      () => {
        setBusy(false);
        ui.flash('Не вдалося вийти. Спробуй ще раз');
      },
    );
  };
  return (
    <AuthPage title={title}>
      <div className={s.card}>
        <p className={s.text}>{text}</p>
        <div className={s.actions}>
          <button type="button" className={s.submit} onClick={signOut} disabled={busy} aria-busy={busy || undefined}>
            Вийти й продовжити
          </button>
          <button type="button" className={s.secondary} onClick={leaveLinkPage}>
            Повернутися в застосунок
          </button>
        </div>
      </div>
    </AuthPage>
  );
}

/**
 * iOS Safari after a finished link (D29): the name to sign in with (selectable), what to do in the home-screen app,
 * optionally the install steps, and «Продовжити в Safari».
 */
export function LinkDone({
  title,
  username,
  text,
  installSteps = false,
  target,
}: {
  title: string;
  username: string;
  text: string;
  installSteps?: boolean;
  target: string;
}) {
  return (
    <AuthPage title={title}>
      <div className={s.card}>
        <p className={s.doneName}>
          Імʼя для входу: <span className={s.selectAll}>{username}</span>
        </p>
        <p className={s.text}>{text}</p>
        {installSteps ? <InstallSteps /> : null}
        <button type="button" className={s.submit} onClick={() => authEnv().replace(target)}>
          Продовжити в Safari
        </button>
      </div>
    </AuthPage>
  );
}

/**
 * iOS Safari only: the link can be pasted into the installed app («Маю посилання» on its login screen). The URL is
 * rebuilt from the stored token (the fragment is gone from the address bar).
 */
export function CopyLinkNote({ kind, token }: { kind: LinkKind; token: string }) {
  const [failed, setFailed] = useState(false);
  const url = `${window.location.origin}${linkPath(kind, token)}`;
  const copy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      setFailed(true);
      return;
    }
    clipboard.writeText(url).then(
      () => {
        setFailed(false);
        ui.flash(COPY_LINK.copied);
      },
      () => setFailed(true),
    );
  };
  return (
    <div className={s.footer}>
      <p className={s.hint}>{COPY_LINK.note}</p>
      <button type="button" className={s.ghost} onClick={copy}>
        {COPY_LINK.button}
      </button>
      {failed ? (
        <>
          <p className={s.hint}>{COPY_LINK.failed}</p>
          <p className={s.linkUrl}>{url}</p>
        </>
      ) : null}
    </div>
  );
}
