import type { ReactNode } from 'react';
import { isStandalone } from '@/lib/platform';
import { ui } from '@/store/ui';
import { Button, Sheet } from '@/ui';
import s from './InstallSheet.module.css';

export const INSTALL_HEADING = 'Встановлення на iPhone';
/** Public address of the app (SPEC §1). */
export const APP_HOST = 'fit.triple-a.dev';

/** The iOS «Поділитися» glyph: a tray with an arrow pointing up. */
export function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 14.5V3" />
      <path d="M8 6.8 12 3l4 3.8" />
      <path d="M8.5 10H6.8A1.8 1.8 0 0 0 5 11.8v7.4A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8v-7.4a1.8 1.8 0 0 0-1.8-1.8h-1.7" />
    </svg>
  );
}

/**
 * Current iOS Safari: in the default compact layout «Поділитися» sits in the «•••» menu at the
 * bottom (older layouts show it right in the bar). The add sheet has an «Open as Web App» switch
 * that must stay on, otherwise Safari makes a plain bookmark and push never works. The installed
 * app keeps its own storage, so she signs in there once.
 */
function steps(iconClass: string): ReactNode[] {
  return [
    <>
      Відкрий <b>{APP_HOST}</b> у Safari
    </>,
    <>
      Натисни <b>«Поділитися»</b> <ShareIcon className={iconClass} /> — кнопка внизу екрана або в меню{' '}
      <b>«•••»</b>
    </>,
    <>
      Обери <b>«На початковий екран»</b>, залиш увімкненим <b>«Відкривати як вебпрограму»</b> і натисни{' '}
      <b>«Додати»</b>
    </>,
    <>Відкрий Легко з іконки й увійди ще раз (лише першого разу)</>,
    <>
      Увімкни сповіщення в <b>«Нагадуваннях»</b>
    </>,
  ];
}

/** How to add the app to the iPhone home screen (push notifications only work there). */
export function InstallSheet({ open }: { open: boolean }) {
  const installed = isStandalone();
  return (
    <Sheet
      open={open}
      onClose={ui.closeSheet}
      heading={INSTALL_HEADING}
      footer={
        <Button size="lg" fullWidth onClick={ui.closeSheet}>
          Зрозуміло
        </Button>
      }
    >
      {installed ? (
        <p className={s.done}>Готово — Легко вже встановлено ✨</p>
      ) : (
        <>
          <p className={s.intro}>
            На iPhone нагадування приходять лише в застосунок, доданий на початковий екран.
          </p>
          <ol className={s.steps}>
            {steps(s.icon ?? '').map((text, i) => (
              <li key={i} className={s.step}>
                <span className={s.num}>
                  {i + 1}
                </span>
                <span className={s.text}>{text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Sheet>
  );
}
