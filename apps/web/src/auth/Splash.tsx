import { useEffect, useState } from 'react';
import { LogoMark } from '../screens/login/LogoMark';
import s from './Splash.module.css';

const SLOW_MS = 8_000;
const SLOW_HINT = 'Підключаюся до сервера…';

/**
 * Calm start-up screen: paper background with the centered logo, which fades in only after a
 * short delay so a quick session check shows nothing but the background.
 */
export function Splash({ hint }: { hint?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  const text = hint ?? (slow ? SLOW_HINT : null);

  return (
    <div className={s.splash} role="status" aria-busy="true">
      <LogoMark className={s.mark} />
      {text ? <p className={s.hint}>{text}</p> : <span className="visually-hidden">Завантаження…</span>}
    </div>
  );
}
