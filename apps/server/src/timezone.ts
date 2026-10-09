/**
 * CLDR (and so `Intl` in Node 24) still reports a few zones under their pre-rename ids, e.g.
 * `Europe/Kyiv` resolves to `Europe/Kiev`. Newer runtimes keep whatever id they were given.
 * Map both spellings to the current IANA name, which is what the app stores by default.
 */
const CURRENT_NAME: Readonly<Record<string, string>> = {
  'Europe/Kiev': 'Europe/Kyiv',
  // Merged into Europe/Kyiv (tzdata 2022g); only seen on runtimes that do not canonicalise.
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/**
 * One spelling per zone: `Intl` canonicalisation (case, links such as `US/Eastern` →
 * `America/New_York`) followed by the current IANA name. Unknown ids are returned unchanged.
 */
export function canonicalTimeZone(timeZone: string): string {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return timeZone;
  }
  return CURRENT_NAME[resolved] ?? resolved;
}

/** Whether two ids name the same zone (`Europe/Kiev` = `Europe/Kyiv`). */
export const sameTimeZone = (a: string, b: string): boolean => canonicalTimeZone(a) === canonicalTimeZone(b);
