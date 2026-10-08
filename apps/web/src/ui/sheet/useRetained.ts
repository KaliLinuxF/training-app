import { useState } from 'react';

/**
 * Returns `value`, or the last non-null value after it became `null`.
 * Lets a sheet keep rendering its content while it animates out:
 *
 *   const sheet = useSheet();
 *   const shown = useRetained(sheet);
 *   <Sheet open={sheet !== null} …>{shown && <DayForm state={shown} />}</Sheet>
 */
export function useRetained<T>(value: T | null): T | null {
  const [kept, setKept] = useState<T | null>(value);
  if (value !== null && value !== kept) setKept(value);
  return value ?? kept;
}
