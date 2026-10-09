import { isIOS, isStandalone } from '@/lib/platform';

/** localStorage flag: the «Встанови Легко на iPhone» banner was hidden on this device. */
export const INSTALL_HINT_KEY = 'legko.installHint.dismissed';

export function isInstallHintDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    // Storage blocked (private mode, disabled site data): show the hint.
    return false;
  }
}

export function rememberInstallHintDismissed(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1');
  } catch {
    // Nothing to do: the banner stays hidden until the next launch.
  }
}

/** iPhone/iPad Safari (not the installed app) and the hint was not hidden before. */
export const shouldShowInstallHint = (): boolean =>
  isIOS() && !isStandalone() && !isInstallHintDismissed();
