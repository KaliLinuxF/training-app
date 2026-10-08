/** Joins truthy class names: `cx(s.a, on && s.b, className)`. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
