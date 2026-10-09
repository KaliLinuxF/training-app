/** A food-text line produced by an estimate or a frequent-dish chip ends with «— 420 ккал». */
const ESTIMATED_LINE = /—\s*\d[\d\s\u00A0\u202F]*\s*ккал\s*$/u;

/**
 * The part of the «Що я їла» text she typed after the last estimated line — what «✨ Порахувати»
 * should count. Lines are joined with ', '. '' when everything is already estimated (or empty).
 */
export function unestimatedTail(text: string): string {
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (ESTIMATED_LINE.test(l.trim())) last = i;
  });
  return lines
    .slice(last + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Inserts an estimate into the food text: replaces the unestimated tail it was made from
 * (when that tail is still there unchanged), otherwise appends the line on a new line.
 */
export function insertEstimate(text: string, line: string, consumed: string): string {
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (ESTIMATED_LINE.test(l.trim())) last = i;
  });
  const head = lines.slice(0, last + 1);
  const tail = lines
    .slice(last + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ');
  if (consumed && tail === consumed.trim()) return [...head, line].filter((l) => l.trim()).join('\n');
  const base = text.replace(/\s+$/u, '');
  return base ? `${base}\n${line}` : line;
}
