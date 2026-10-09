/**
 * Time-zone comparison for `settings.timezone`. Browsers disagree on the spelling of some zones
 * (Chrome resolves Kyiv to the legacy «Europe/Kiev», the data stores «Europe/Kyiv»), so the raw
 * strings say little; what matters for reminders is whether the clocks match.
 */

const DAY_MS = 86_400_000;
/** One year ahead covers every DST rule a zone currently has. */
const DAYS_CHECKED = 366;

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  let fmt = formatters.get(zone);
  if (fmt === undefined) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      });
    } catch {
      fmt = null;
    }
    formatters.set(zone, fmt);
  }
  return fmt;
}

/** The wall-clock time `instant` shows in the formatter's zone, read as if it were UTC (ms). */
function wallClock(fmt: Intl.DateTimeFormat, instant: number): number {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0);
}

/**
 * Whether two IANA zones show the same local time every day of the coming year: aliases such as
 * «Europe/Kiev» / «Europe/Kyiv» do, «Europe/Simferopol» / «Europe/Kyiv» do not (no DST in Crimea).
 * An unknown zone only equals itself.
 */
export function sameTimeZone(a: string, b: string, from: number = Date.now()): boolean {
  if (a === b) return true;
  const fa = formatter(a);
  const fb = formatter(b);
  if (!fa || !fb) return false;
  for (let day = 0; day <= DAYS_CHECKED; day++) {
    const instant = from + day * DAY_MS;
    if (wallClock(fa, instant) !== wallClock(fb, instant)) return false;
  }
  return true;
}
