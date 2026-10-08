import { todayISO, type ISODate } from '@legko/shared';
import { useEffect, useState } from 'react';

/** Today's local date; rolls over at midnight and when the app comes back to the foreground. */
export function useToday(): ISODate {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const update = () => setToday((prev) => {
      const now = todayISO();
      return now === prev ? prev : now;
    });
    const iv = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return today;
}

/** «Доброго ранку / дня / вечора» by the current hour (re-evaluated with `today`). */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Доброго ранку' : h < 18 ? 'Доброго дня' : 'Доброго вечора';
}
