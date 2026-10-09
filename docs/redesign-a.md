# Redesign A «Чек-лист дня» — integrated implementation plan

Owner decision (2026-10-09): variant **A «Чек-лист дня»**. Owner feedback: «зараз усе занадто нагромаджено, на
телефоні дуже незручно». This plan merges the six area specs (Home, Capture «+», Settings, Progress, Calendar,
Shell + kit) into one design with one kit, one set of contracts and strictly separated work packages.

**Same visual style.** 1b «Свіжість» tokens from `apps/web/src/styles/tokens.css` only (no hard-coded colours),
Manrope, the 1b radius scale, lavender `--acc` + mint `--acc2`, light + dark, reduced motion. What changes is the
**layout**: fewer boxes inside boxes, rows instead of tile grids, bigger primary numbers, fewer muted micro-labels,
one-hand reach. This is a deliberate deviation from the prototype layout (SPEC §2 text in §7 below).

**Revision 2 (finalized after three adversarial reviews).** Every critique point was checked against the code; the
accepted fixes are folded into the sections below and listed in §11, the rejected ones in §12 «Rejected critique».

Hard constraints for every package:

- Never edit `apps/web/src/features/food/**` or `apps/web/src/ui/sheet/**` (another workflow is changing them:
  stackable sheets, AI-estimate item editor). Use only the public props of `FoodAssist`, `PhotoStrip` and `Sheet`.
- All SPEC §1.1 requirements stay satisfied (matrix in §6).
- Tap targets ≥ 44px, inputs ≥ 16px, real buttons/links, `aria-pressed` toggles, visible focus ring.
- Desktop shell (`DESKTOP_QUERY` = `(min-width: 900px) and (hover: hover) and (pointer: fine)`, 248px sidebar,
  2-column `ContentGrid`) stays sensible.

---

## 0. Summary

| Screen | Before | After |
| --- | --- | --- |
| Home | ~2.3 phone screens, 7 blocks, up to 4 banners | **one screen**: header · compact hero · «Сьогодні» list of 4 action rows · week row; at most one compact banner |
| «+» | always the long «Запис дня» form | **«Що записати?»** menu (4 big rows) → short focused sheet (Їжа / Тренування / Вага / Заміри); «Запис дня» kept for full editing |
| «Нагадування» tab | 2.5 screens of cards | **«Налаштування»**: grouped list with summaries → sub-pages `/settings/:section`; desktop list + detail |
| Progress | ~2.9 screens, summary table repeats sections | ~2.2 screens; sticky period bar with paper backdrop; summary = one sentence line (SPEC §1.1 #7 wording); stat strips instead of tile grids; 3-row kcal history |
| Calendar | ~3 screens incl. «Останні записи» | ~1.3 screens: month grid + day check-list whose rows open short sheets, inline ✓/✕ for the workout, the day scrolls into view after a tap; «Сьогодні» shortcut |
| Shell | 5 equal tab slots, bell tab, «+» → day form | 3-part tab grid (fits «Налаштування»), gear tab, «+» → menu, active tab pops a sub-page |

---

## 1. Decisions (conflicts between the area specs, resolved)

| # | Topic | Options seen | Decision |
| --- | --- | --- | --- |
| D1 | Workout sheet mode name | `'training'` (Home, Shell, Calendar) / `'workout'` (Capture) | **`'workout'`** — same word as `ReminderKind 'workout'`, `DEEP_LINKS.workout`, `settings.rem.workout`, `?sheet=workout`. |
| D2 | `SheetMode` owner | Capture | **kit package** lands the type change in `store/ui.ts` first (pure contract used by Home, Calendar, Shell, Progress); Capture implements it in `sheets/**`. |
| D3 | Home inline «✓ Було» | open `'workout'` with `{trained:true}` (Capture) / save instantly (Home) | **Save instantly** + toast «Відмічено: тренування було»; types are added by tapping the row («Було · додай тип» nudge). The `{trained:true}` patch stays for the push deep link. Owner question Q1. The same inline ✓/✕ is on the calendar day card's Тренування row (any past date), through one shared action `setTrainedMark` in `store/dayMarks.ts` (kit, D25). |
| D4 | Home «Відкрити день →» | removed (Shell, Capture assumed) / kept (Home) | **Kept** in the «Сьогодні» header → full `'day'` sheet (today's notes, whole day; keeps food/offline e2e stable). |
| D5 | Menu sheet | separate `RecordMenuSheet`, `size="compact"` (Shell) / mode `'menu'` in the same `RecordSheet` (Capture) | **Capture's**: one `<Sheet>` instance renders `'menu'` and every form mode, the body swaps in place (no second slide-up, no backdrop flicker). Default size. |
| D6 | List primitive | ListGroup/ListRow, ActionList/ActionRow/RowIcon, ListCard/ListRow, DayRow | **One `ListGroup` + `ListRow`** in `ui/lists/` (md 60px, lg 72px). Used by Home, the menu, Settings, Calendar, Home week row. |
| D7 | Icons | ActionIcon, RowIcon, SettingsIcon, NavIcon | **One `Icon`** in `ui/icons/` (24-grid line icons, 1.8 stroke, currentColor). The tinted square belongs to `ListRow`. `shell/NavIcon.tsx` is deleted. |
| D8 | Stats primitive | StatStrip (Progress) / StatChips + Stat/StatRow (Shell) | **`StatStrip` only** (big unboxed numbers) for Progress workouts (4) and nutrition (2). The period summary is **not** a strip (D22). |
| D9 | Sticky period backdrop | kit `Segmented sticky` band + `--gutter` (Shell) / local `PeriodBar` (Progress) | **Local `PeriodBar`** in `screens/progress`; kit `Segmented` untouched; no `--gutter` variable. |
| D10 | Sub-page back | `ScreenHeader.back` + `{settingsList:true}` (Settings) / `SubpageHeader` + `legkoFrom` (Shell) | **`ScreenHeader.back`** + kit `useBackTo` / `cameFrom` with history state key **`legkoFrom`**, stamped automatically by `ListRow href`. The active tab on a sub-route uses the same `useBackTo`. |
| D11 | Settings slugs | `workouts` / `types` | **`reminders · goals · workouts · appearance · data`**. Flat routes (no wouter `nest`). |
| D12 | «Налаштування» tab label fit | 10px labels everywhere (Settings) / 3-part grid (Shell) | **3-part grid** `minmax(0,1fr) 64px minmax(0,1fr)`, labels stay 11px; 10px only below 360px. |
| D13 | Shell file ownership | Settings, Capture, Shell all edit `shell/**` | **Shell package owns `apps/web/src/shell/**`** (nav rename, icons, NavLink, «+» → `'menu'`, AppShell). `App.tsx` routes → Settings package. |
| D14 | Mobile top padding | 20px (prototype) / 12px (Shell) | **`calc(12px + var(--safe-top))`**. Recounted with real kit sizes (§4.2), Home has ~43px slack after the hero/header/week-row trims; the old count (26px) was wrong. |
| D15 | Dismissible banner | `screens/home/DismissibleBanner` | **kit `Banner`** gains `size="compact"`, `onDismiss`, `dismissLabel`, optional CTA; DismissibleBanner deleted. |
| D16 | Inline toggle | `size="compact"` (Home) / `size="sm"` (Shell) | **`TrainingToggle size="sm"`**: two 44×44 glyph buttons, gap 6, names «Було» / «Не було». |
| D17 | Calendar day rows | local DayRow | **kit `ListRow`** with `subWrap` (pre-line text) and `children` (PhotoStrip outside the row button). |
| D18 | Setup sheet name | «Налаштування» clashes with the new tab | **«Перші кроки»**; SETUP_INTRO and install step 5 point to «Налаштування». Owner question Q6. |
| D19 | Menu row statuses | duplicate Home logic? | Menu computes its own light statuses in `sheets/record/menuModel.ts` from existing `lib/stats` (`dueReminders`, `weighedOn`, `measuredOn`) + `kcalGoalView` — no dependency on Home's new `weeklyCheck`, so packages stay parallel. |
| D20 | e2e helpers | every planner edits `e2e/support/app.ts` | **kit package owns it** and lands all new helpers first, with **type-compatible** deprecated shims (`quickAction`, `go`/`heading('Нагадування')`, `sheet('Налаштування')`), so every spec typechecks during parallel work. The shims do NOT preserve old behaviour (`quickAction('Харчування')` now opens «Їжа», `go('Нагадування')` lands on the list); every caller is migrated by its owner or by e2e-visual (D26). |
| D21 | Kit pruning (QuickAction, StatTile, Tile, Section, DetailRow, KeyValueRow control/summary, Card `list`, BarRow `history`, Segmented `sticky`) | delete in this pass? | **Not in this plan.** Deleting while screens migrate in parallel breaks typecheck. Follow-up task after merge (§10). |
| D22 | Summary «line/chips» (owner) | chips / strip / sentence | **One wrapped sentence line** in the tint card, exactly the SPEC §1.1 #7 wording: «Тренувань **2** · сер. калорійність **1 795** ккал · вага **−0,3** кг · талія **−0,5** см · стегна **−0,5** см · груди **0** см» (numbers 17/700 deltaTone, words 15 `--ink2`, each item `nowrap`). Not a strip/table (it repeated the sections), not chips (boxes again). ~130px instead of 185. |
| D23 | SPEC.md | many planners | **e2e-visual** (final) package applies §7. |
| D24 | Food workflow's in-flight e2e files | only `food.spec.ts` guarded | **`e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/gestures.spec.ts`, `e2e/food.spec.ts` are all gated**: edited only when `git status --porcelain <file>` is empty. The gestures.spec migration moves from capture to e2e-visual; capture's new menu drag test lives in `e2e/capture.spec.ts`. The food workflow's tests and shots `531-estimate-list` … `537-estimate-list-after` (+ `532-editor-row-bottom`) are kept; `53x-*` are never deleted as stale. |
| D25 | Training mark shared by Home and Calendar | Home-only `markNoTraining` | **kit adds `apps/web/src/store/dayMarks.ts`**: pure `markTrained` / `markNoTraining`, `TRAINED_TOAST` / `NO_TRAINING_TOAST`, and `setTrainedMark(date, trained): boolean` (no-op when unchanged, `dataActions.saveDay`, toast only when saved). Home and Calendar both call it. |
| D26 | Stale assertions in specs owned by parallel packages | nobody may fix | Parallel packages can only typecheck e2e, so **e2e-visual may fix stale test-only assertions in any `e2e/*.spec.ts`** during the final gate (never app code, never weakening intent), logging each change per owning package. Known stale lines are also listed in the settings and capture briefs. |
| D27 | Theme summary on the Settings list | `useThemePref` per component | `useThemePref` is per-component `useState`, so the desktop list (mounted next to AppearanceCard) would go stale. **SettingsScreen calls it once** and passes `pref` to the list and `[pref, setPref]` to AppearanceCard — same pattern as the lifted `usePushStatus`. |

---

## 2. Shared kit — final APIs (package `kit`, lands first)

Everything is exported from `@/ui` (`apps/web/src/ui/index.ts`, new block «Lists & icons», the Sheet block is not
touched). Tokens only. Every component takes `className` (merged last).

### 2.1 `Icon` — `ui/icons/Icon.tsx`, `ui/icons/paths.ts`

```ts
export type IconName =
  | 'home' | 'calendar' | 'chart' | 'gear'                   // tab bar / sidebar
  | 'food' | 'workout' | 'weight' | 'measure' | 'notes'      // actions, day rows
  | 'bell' | 'target' | 'theme' | 'data' | 'logout'          // settings rows
  | 'chevronRight' | 'chevronLeft';
export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>>; // 24×24 grid, content within 3–21
export interface IconProps { name: IconName; size?: 16 | 20 | 22 | 24 /* default 24 */; className?: string }
export function Icon(props: IconProps): JSX.Element;
// <svg width/height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
//      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
```

`home`, `calendar`, `chart` and `bell` paths move from `shell/NavIcon.tsx` unchanged. New: `gear` (cog outline +
`M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z`), `food` (bowl + 2 steam strokes), `workout` (dumbbell:
`M6.5 8v8`, `M3.5 10v4`, `M17.5 8v8`, `M20.5 10v4`, `M6.5 12h11`), `weight` (scale), `measure` (tape with 3 ticks),
`notes` (page with 2 lines), `target` (two circles + dot), `theme` (moon
`M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z`), `data` (cloud), `logout` (door + arrow),
`chevronRight` `M9.5 6l6 6-6 6`, `chevronLeft` `M14.5 6l-6 6 6 6`. No emoji anywhere in rows.

### 2.2 `ListGroup` — `ui/lists/ListGroup.tsx` (+ `.module.css`)

```ts
export interface ListGroupProps {
  children: ReactNode;            // ListRow elements only
  title?: ReactNode;              // in-card <h2>: md 18/700 −0.01em (Home «Сьогодні»), lg 20/700 −0.015em (calendar day)
  titleSize?: 'md' | 'lg';        // default 'md'
  titleId?: string;               // default useId()
  subtitle?: ReactNode;           // 14 --muted under the title («середа · сьогодні»)
  headerRight?: ReactNode;        // ghost Button «Відкрити день →», Pill «Частково»
  footer?: ReactNode;             // inside the card under the rows («Редагувати день»)
  caption?: ReactNode;            // iOS group label above the card: <h2> 14/600 --muted, padding 0 16px
  note?: ReactNode;               // 13 --muted below the card, line-height 1.4
  'aria-label'?: string;
  'aria-labelledby'?: string;
  full?: boolean;                 // grid-column: 1 / -1
  flush?: boolean;                // rows <ul> padding 0 (single-row groups: Home week row)
  className?: string;             // on the root
}
```

- Ids: `const autoTitleId = useId(); const autoCaptionId = useId();` at the top of the component (never
  `titleId ?? useId()`, which is a conditional hook call); `headingId = titleId ?? autoTitleId`.
- Root: `<section aria-labelledby={headingId | captionId}>` when `title` or `caption` is given (region named by it,
  never by the subtitle), `<section aria-label>` when only `aria-label`/`aria-labelledby` is given, otherwise `<div>`.
- Card: `--card`, 1px `--line`, `--r24`, `overflow: clip` (fallback `hidden`). Header (only with `title`):
  flex space-between, align center, gap 12, padding `12px 16px 2px`. Rows: `<ul role="list">`, margin 0,
  padding `4px 0` (`flush` → 0), list-style none. Footer: padding `4px 16px 16px`.
- Column gap 8 between caption / card / note.

### 2.3 `ListRow` — `ui/lists/ListRow.tsx` (+ `.module.css`)

```ts
export type ListIconTone = 'acc' | 'acc2' | 'neutral';
export interface ListRowBaseProps {
  title: ReactNode;
  titleTone?: 'ink' | 'accent';            // 'accent' → --accD («Вийти»)
  sub?: ReactNode;                          // line 2: 14/500 lh 1.35 --ink2, clamped to 2 lines
  subTone?: Tone;                           // override colour (toneClass)
  subWrap?: boolean;                        // no clamp, white-space: pre-line, overflow-wrap: anywhere (calendar text)
  icon?: IconName;
  iconTone?: ListIconTone;                  // default 'neutral'
  value?: ReactNode;                        // right status: text or <Pill>
  valueVariant?: 'strong' | 'soft';         // strong 15/700 --ink (default) · soft 15/500 --ink2
  valueTone?: Tone;
  meter?: { value: number; tone: 'acc' | 'acc2' }; // 6px ProgressBar sm under the title, decorative
  chevron?: boolean;                        // default: true when href/onClick, false for a static row
  trailing?: ReactNode;                     // sibling control AFTER the action element (TrainingToggle sm, Switch)
  children?: ReactNode;                     // block under the row, outside the action (PhotoStrip)
  size?: 'md' | 'lg';                       // default 'md'
  'aria-label'?: string;                    // default name = visible content (title, sub, value)
  'aria-describedby'?: string;
  describeSub?: boolean;                    // with aria-label: the sub text becomes the action's description
  className?: string;
}
export type ListRowProps = ListRowBaseProps &
  (
    | { href: string; replace?: boolean; current?: boolean; onClick?: never; disabled?: never }
    | { onClick: () => void; disabled?: boolean; 'aria-haspopup'?: 'dialog'; href?: never; current?: never; replace?: never }
    | { href?: never; onClick?: never; disabled?: never; current?: never; replace?: never }
  );
```

- Markup: `<li class=item>` → action element (wouter `<Link href state={backState(location)} replace aria-current={current ? 'page' : undefined}>`
  | `<button type="button">` | `<div>`) → then `trailing` (sibling, never nested) → then `children` in `.extra`.
  Must be rendered inside a `ListGroup`.
- Action grid: `grid-template-columns: auto minmax(0,1fr) auto auto`; areas `'icon title value chev' / 'icon sub sub chev'`
  (+ `meter` under the title row). **`column-gap: 0`** — CSS grid keeps a gap next to an empty `auto` track, so
  spacing comes from margins on the elements that exist: icon `margin-right: 14px`, value `margin-left: 12px`,
  chevron `margin-left: 8px`. A row without an icon starts its title at the 16px padding. Text-align left, transparent
  background, inherits colour, no underline, `-webkit-touch-callout: none`, `touch-action: manipulation`.
- **md**: min-height 60, padding `10px 16px`, row-gap 2; icon square 40×40 `--r12` with a 22px glyph;
  title 16/600 lh 1.3 `--ink`; chevron = `Icon chevronRight` 16 in `--faint`; divider 1px `--line2` on `.item + .item::before`
  from x = 70 (16 when no icon).
- **lg** (menu): min-height 72, padding `12px 16px`, icon 48×48 `--r14` with a 24px glyph, title 17/600; divider from 78.
- **≤ 359px** (`@media (max-width: 359px)`, 320px Display Zoom): action padding-left 12, md icon 36×36 with a 20px
  glyph and margin-right 12, `.trailing` padding-right 12, divider inset 60. At 320 the Home training row keeps a
  ~108px title column («Тренування» 16/600 ≈ 93px).
- Icon tones: `acc` → `--accT` square / `--accD` glyph; `acc2` → `--acc2T` / `--acc2D`; `neutral` → `--line2` / `--ink2`.
- Value: max-width 60%, text-align right, may wrap, tabular numbers.
- With `trailing`: action padding-right 8; `.trailing` padding-right 16, flex, align center, gap 8.
- `.extra`: padding `0 16px 12px <inset>px`, `position: relative` (thumb buttons stay tappable).
- `describeSub` (opt-in; calendar food/notes rows): the sub gets an id from a top-level `useId()` and the action gets
  `aria-describedby` = that id (+ any given `aria-describedby`), so a short `aria-label` does not hide the text.
- States: `:active` background `--line2` (transition background-color 120ms; the global reduced-motion rule kills it);
  `@media (hover:hover) and (pointer:fine)` `:hover` → `--paper`; **`[aria-current]` → background `--accT`, title
  `--accD`** (the sidebar/tab-bar active pattern; `--line2` on `--card` was ≈1.1:1 and invisible in the desktop
  Settings list); `:focus-visible` → `outline: 2px solid var(--focus); outline-offset: -3px; border-radius: var(--r20)`
  (inset, so the group's overflow clip never cuts it); `disabled` → opacity .45.

### 2.4 Back navigation — `ui/internal/backNav.ts` (exported from `@/ui`)

```ts
export const BACK_STATE_KEY = 'legkoFrom';
export function backState(from: string): { legkoFrom: string };
export function cameFrom(state: unknown, parent: string): boolean;   // true only for { legkoFrom: parent }
export function useBackTo(parent: string): (e?: { preventDefault(): void }) => void;
// history.back() when cameFrom(window.history.state, parent), else navigate(parent, { replace: true }).
```

### 2.5 `ScreenHeader` — new optional props

```ts
export interface ScreenHeaderProps {
  subtitle?: ReactNode; title: ReactNode; right?: ReactNode; className?: string;  // unchanged
  back?: { href: string; label: string };   // «‹ Налаштування» link above the title, name `Назад: ${label}`
  focusTitle?: boolean;                     // h1 gets tabIndex −1 and focus({ preventScroll: true }) on mount
}
```

Back link: a private `BackLink({ href, label })` component inside `ScreenHeader.tsx` calls
`const backTo = useBackTo(href)` at its top level and renders `<Link href={href} aria-label={`Назад: ${label}`}
onClick={backTo}>` (backTo calls `preventDefault`). ScreenHeader renders `{back && <BackLink {...back} />}` — never
call the hook inside the click handler or conditionally. Inline-flex, gap 2,
`Icon chevronLeft` 20 + label, 15/600 `--accD`, min-height 44, padding `0 10px 0 4px`, margin-left −8px, `--r12`,
`:active` background `--accT`. With `back` the header is a column (link, then subtitle/title row).

### 2.6 `Banner` — compact + dismiss

```ts
export type BannerProps = {
  title: ReactNode; sub?: ReactNode;
  size?: 'md' | 'compact';                  // default 'md' = today's look
  onDismiss?: () => void; dismissLabel?: string /* «Сховати» */;
  full?: boolean; className?: string;
} & ({ cta: string; onAction: () => void } | { cta?: never; onAction?: never });
```

Compact: min-height 56, padding `8px 8px 8px 14px`, gap 10, `--r16`, 8px `--acc` dot, title 14/600 (2-line clamp),
sub 13 lh 1.35 `--ink2` with a **3-line clamp** (no clamp below 360px; no single-line ellipsis: at 390px the text
column is ~185px; after the fix round the setup sub is the short «Запиши стартову вагу й ціль»), CTA
`Button size="sm"`, ✕ = 32×32 transparent glyph button 13/600 `--ink2` with `::after { inset: -6px }` (44px hit
area), `:active` scale .94.

### 2.7 `TrainingToggle size="sm"`

`size?: 'sm' | 'md' | 'lg'`. `sm`: grid `44px 44px`, gap 6; each option 44×44, `--r14`, 1.5px border, glyph
«✓»/«✕» 18/700 `aria-hidden` + visually-hidden text «Було» / «Не було» (accessible names unchanged), `aria-pressed`,
`:active` scale .96. Colours as md/lg (✓ pressed `--accT` + `--acc` border + `--accD` glyph; ✕ pressed `--solid` bg,
`--onSolid` glyph, `--ink` border). `onChange` still fires on every press.

### 2.8 `StatStrip` — `ui/tiles/StatStrip.tsx`

```ts
export interface StatItem { label: string; value: string; unit?: string; tone?: Tone }
export interface StatStripProps {
  items: readonly StatItem[];
  columns?: 2 | 3 | 4;              // phone; default min(items.length, 4)
  desktopColumns?: 2 | 3 | 4;       // inside the DESKTOP_QUERY media query; default = columns
  'aria-label'?: string; className?: string;
}
```

Used by Progress «Тренування» (4 cells) and «Харчування» (2 cells). The period summary is a sentence line (D22).

`<dl>` grid (column-gap 12, row-gap 14, margin 0); cell `<div>` = `<dt>` label + `<dd>` value (+ `<span>` unit);
`flex-direction: column-reverse` shows the value on top while textContent stays «Тренувань2». Value 22/700 −0.02em
lh 1.15 nowrap in `tone`; «—» always `--faint`; label 13/500 lh 1.3 `--ink2` (wraps); unit 13/600 `--ink2`, margin-left 3.

### 2.9 `store/ui.ts` — contract

```ts
/**
 * - `menu`    — «Що записати?»: four actions for the date (opened by «+»)
 * - `day`     — full «Запис дня» (training, food, kcal, weight, measurements, notes) — calendar / history / «Відкрити день»
 * - `food`    — «Їжа»: food text, photos, FoodAssist, kcal
 * - `workout` — «Тренування»: ✓/✕, types, optional notes
 * - `weight`  — «Контрольне зважування»;  `measure` — «Заміри тіла»
 * - `setup`   — «Перші кроки» (first run);  `install` — «Встановлення на iPhone»
 */
export type SheetMode = 'menu' | 'day' | 'food' | 'workout' | 'weight' | 'measure' | 'setup' | 'install';
/** `trained` pre-fills the `workout` and `day` sheets (push deep link). */
export interface SheetPatch { trained?: boolean }
```

`ui.openSheet` / `closeSheet` / `flash` / `confirm` unchanged.

### 2.10 Ghost button hit area — `ui/controls/Button.module.css`

`.ghost` is 35px tall (`padding: 8px 0`, 14px text) and `.ghost::after { inset: -4px -6px }` gave only **43px**
(today patched locally in `screens/home/TodayCard.module.css`). Kit changes it to `inset: -5px -6px` (45px) with a
kitStyles contract (ghost vertical reach ≥ 44). «Відкрити день →», «Повний запис дня →» and «+ Нотатка до дня» rely on it;
the local TodayCard override goes away.

### 2.11 Training mark — `store/dayMarks.ts` (kit, D25)

```ts
export const TRAINED_TOAST = 'Відмічено: тренування було';
export const NO_TRAINING_TOAST = 'Відмічено: без тренування';
export function markTrained(entry: DayEntry | undefined): DayEntry;    // { ...EMPTY_DAY, ...entry, trained: true } (types/food/kcal/notes/photos kept)
export function markNoTraining(entry: DayEntry | undefined): DayEntry; // { ...EMPTY_DAY, ...entry, trained: false, types: [] }
/** One-tap ✓/✕ for any date: no-op (false) when already `trained`; saves; toasts only when the save went through. */
export function setTrainedMark(date: ISODate, trained: boolean): boolean;
```

Moved from `screens/home/homeModel.ts` (home deletes its copy). Used by Home «Сьогодні» and the calendar day card.

---

## 3. Contracts between packages

### 3.1 Who opens which sheet

| Caller | Action | Call |
| --- | --- | --- |
| Tab bar «+», sidebar «+ Записати день» | menu | `ui.openSheet(today, 'menu')` |
| Menu rows | Їжа / Тренування / Вага / Заміри | `ui.openSheet(date, 'food' / 'workout' / 'weight' / 'measure')` (same Sheet instance) |
| Menu «Повний запис дня →» | full day | `ui.openSheet(date, 'day')` |
| Home rows | Їжа / Тренування / Вага / Заміри | `ui.openSheet(today, 'food' / 'workout' / 'weight' / 'measure')` |
| Home «Відкрити день →» | full day | `ui.openSheet(today, 'day')` |
| Home ✓ / ✕ | no sheet | `setTrainedMark(today, v)` (`store/dayMarks.ts`: save + toast) |
| Home banners | setup / install | `'setup'` / `'install'` |
| Calendar day rows | per row, selected date | `'food'`, `'workout'`, `'weight'`, `'measure'`, notes row → `'day'` |
| Calendar Тренування ✓ / ✕ | no sheet | `setTrainedMark(selected, v)` (today or any past date; the calendar never selects a future day) |
| Calendar «Редагувати день» / «Заповнити день» | full day | `'day'` |
| Progress placeholders | «+ Записати вагу» / «+ Записати заміри» | `'weight'` / `'measure'` |

### 3.2 Dialog accessible names (headings)

New: «Що записати?», «Їжа», «Тренування», «Перші кроки». Kept: «Запис дня», «Контрольне зважування», «Заміри тіла»,
«Встановлення на iPhone». Removed: setup «Налаштування».

### 3.3 Deep links (client parsing only; server `DEEP_LINKS` unchanged)

| URL | Opens |
| --- | --- |
| `/?sheet=day&trained=1` (workout push) | «Тренування» with ✓ pre-selected (legacy alias) |
| `/?sheet=day` | «Запис дня» |
| `/?sheet=workout[&trained=1]`, `/?sheet=food` | «Тренування» (patch only with trained=1), «Їжа» |
| `/?sheet=weight`, `/?sheet=measure` | unchanged |
| `menu`, `setup`, `install`, unknown | not linkable, ignored and cleaned from the URL |
| `/progress?period=week\|month\|q\|all` | selects + stores the period, then removes the param (replace) |
| `/calendar?date=YYYY-MM-DD` | unchanged |

### 3.4 Routes (`App.tsx`)

`/` · `/calendar` · `/progress` · `/settings/:section?` (section ∈ reminders | goals | workouts | appearance | data;
anything else → `<Redirect to="/settings" replace />`) · `/reminders` → `<Redirect to="/settings/reminders" replace />`
(old bookmarks, old test notifications) · catch-all → `/`. Server test push url → `/settings/reminders`
(`SETTINGS_REMINDERS_PATH` in `packages/shared/src/api.ts`).

### 3.5 e2e helpers (`e2e/support/app.ts`, kit package)

```ts
export type Section = 'Головна' | 'Календар' | 'Прогрес' | 'Налаштування';
/** @deprecated 'Нагадування' — type-compatible shim only, removed in the §10 prune. */
export type LegacySection = Section | 'Нагадування';
go(section: LegacySection)        // 'Нагадування' clicks «Налаштування» and waits for h1 «Налаштування»
heading(section: LegacySection)   // h1 by name; 'Нагадування' → h1 «Нагадування» (phone sub-page) — keeps auth.spec:49 typechecking
export type SheetName = 'Що записати?' | 'Їжа' | 'Тренування' | 'Запис дня' | 'Контрольне зважування'
  | 'Заміри тіла' | 'Перші кроки' | 'Встановлення на iPhone'
  | 'Налаштування';  // @deprecated old setup name (deep-links.spec:102/104, onboarding.spec:13/85, visual.spec:246)
export type RecordItem = 'Їжа' | 'Тренування' | 'Вага' | 'Заміри' | 'Повний запис дня';
record(item: RecordItem): Promise<Locator>       // «+» → row in «Що записати?» → returns the target sheet locator
homeRow(name: 'Їжа' | 'Тренування' | 'Вага' | 'Заміри'): Locator  // region «Сьогодні» → button /^name/
trainingToggle(name: 'Було' | 'Не було'): Locator                 // region «Сьогодні» → button exact
weekLink(): Locator                                               // link /^Тиждень/
export type SettingsSection = 'Нагадування' | 'Цілі' | 'Типи тренувань' | 'Вигляд' | 'Дані і копія';
export const SETTINGS_SLUGS: Record<SettingsSection, string>;     // reminders, goals, workouts, appearance, data
settingsRow(title: SettingsSection): Locator     // nav «Розділи налаштувань» → link /^title/
openSettings(title): Promise<void>               // go('Налаштування') → row → heading(title)
gotoSettings(title): Promise<void>               // goto(`/settings/${slug}`)
settingsBack(): Locator                          // link «Назад: Налаштування»
quickAction(label)                               // @deprecated → homeRow(label === 'Харчування' ? 'Їжа' : label)
```

The shims keep every existing spec **typechecking**; they do not keep old behaviour (D20). `settingsBack()` exists only
on the phone (the desktop pane has no back link): tests that use it are gated to the `iphone` project.

---

## 4. Screens

Phone numbers are for an iPhone 14 installed app (status bar «default» → web view 390×797, safe-bottom 34).
Floating tab bar top = 797 − 34 − 14 − 70 = **679**. Main padding top 12 (D14). Playwright `iphone` project:
390×844, no safe areas, tab bar top 760.

### 4.1 Shell / tab bar (package `shell`)

```
 ╭──────────────────────────────────────────────────╮  .bar unchanged (glass, --r24, 14px + safe-bottom)
 │  [home]     [cal]     ┌──────┐  [chart]   [gear]  │  inner 70 = 8 + 52 + 8 + 2
 │  Головна   Календар   │  +   │  Прогрес Налаштування
 │ └── group: flex 1fr ─┘ 64px   └── group: flex 1fr ─┘
 ╰──────────────────────────────────────────────────╯
```

- `.inner { grid-template-columns: minmax(0,1fr) 64px minmax(0,1fr) }`; groups `display:flex`, items `flex: 1 1 0;
  min-width: max-content`. 390px: 144px per group ≥ 46 + 79.4 («Налаштування» 11/600). < 360px: bar padding 8,
  centre 60, label 10px −0.01em, icon pill 40 wide (fits 320).
- «+»: 52×52 `--r18` `--solid`, `aria-label="Записати день"`, `aria-haspopup="dialog"`, `aria-expanded` while the
  menu is open; opens `'menu'`. DOM order Головна, Календар, Записати день, Прогрес, Налаштування.
- Tab 4 «Налаштування» (`Icon gear`, `/settings`), active on `/settings/*`; `aria-current="page"` at a section root,
  `"true"` on a sub-route. Tapping the active tab: at the root → smooth scroll to top; on a sub-route → `useBackTo('/settings')`.
- Desktop sidebar: same links («Налаштування»), «+ Записати день» opens the same menu (centred modal), gets
  `aria-haspopup` / `aria-expanded`.
- `<main>` phone padding `calc(12px + var(--safe-top)) 18px calc(120px + var(--safe-bottom))`; desktop unchanged.

### 4.2 Home «Головна» (package `home`)

```
 y    ┌───────────────────────────────────────────┐
 12   │ Середа, 14 жовтня                    (Л)  │  ScreenHeader 68 (14 muted + h1 30/700, Avatar 44)
      │ Доброго ранку                             │
 80   ├ [compact banner 56–72 — only setup OR install hint; none in the installed app] ┤
 94   ┌───────────────────────────────────────────┐
      │ 65,4 кг                       ( −2,9 кг )│  HERO (--solid) ~146, padding 16 20, gap 14;
      │                                           │  h2 «Поточна вага» visually hidden (names the region)
      │ ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  58/700 + «кг» 18 --onSolidMuted; ProgressBar md (8)
      │ 35% шляху                   до цілі 5,4 кг│  15/700 numbers, 13 --onSolidMuted words
 240  └───────────────────────────────────────────┘
 254  ┌───────────────────────────────────────────┐  ListGroup «Сьогодні» ~306 (region «Сьогодні»)
      │ Сьогодні                  Відкрити день → │  header 49 = 12 + ghost 35 + 2
      │ [F] Їжа             1 240 / 1 700 ккал  › │  60  meter 6px (mint ≤ goal, lavender over)
      │     ███████████████░░░░░                  │
      │ ───────────────────────────────────────── │  divider from x=70
      │ [T] Тренування                  [✓] [✕]   │  62  row button | TrainingToggle sm (siblings, gap 6)
      │     За планом о 18:00                     │
      │ [W] Вага                  Пн, 19 жовтня › │  62  (Pill «Сьогодні» when due)
      │     12 жовтня — 65,4 кг                   │
      │ [M] Заміри                Пн, 19 жовтня › │  62
      │     Груди 90 · Талія 70 · Стегна 98       │
 560  └───────────────────────────────────────────┘
 574  ┌───────────────────────────────────────────┐  ListGroup flush + ListRow href «/progress?period=week» 62
      │ Тиждень   2 з 3 трен. · сер. 1 795 ккал › │
 636  └───────────────────────────────────────────┘
 679  ╭──────────────── tab bar ──────────────────╮  ~43px slack = two extra sub lines still fit
```

Budget (recounted from the kit CSS, revision 2): header 68 + 14 + hero 146 + 14 + «Сьогодні» 306 (2 border + 49
header + 8 list padding + 60 + 3 × 62) + 14 + week 62 (2 + 60, `flush`) = **624 of 667px**. Revision 1 claimed 641
but really came to ~657–665 (header 55, rows 61.7, week 70, hero ~172), so one decimal measurement or two workout
types pushed the week row under the tab bar. The trims: hero label hidden + padding 16 (−26), ListGroup header
`12px 16px 2px` (−6), `flush` week group (−8), ListRow `column-gap: 0` (wider title column, fewer 2-line subs).

Rows and states (all copy formatted in `homeModel.ts`):

- **Їжа** (`icon food`, `acc2`) → `'food'`. Value by `kcalGoalView(entry.kcal, settings.kcalGoal).state`:
  empty «—» + « / 1 700 ккал» (13 muted), meter 0 · **recorded** (food text or photo, no kcal; the demo seed's today)
  value «Записано» (soft), **no goal span, no meter**, sub «Калорії не вказані» (tone acc), label «Їжа: записано,
  калорії не вказані. Ціль 1 700 ккал на день» · ok «1 240 / 1 700 ккал» · reached number `--acc2D`, full mint
  meter · over «1 820» `--accD` + full lavender meter. `aria-label` `Їжа: ${view.label}`; empty «Їжа: ще нічого не
  записано. Ціль 1 700 ккал на день».
- **Тренування** (`icon workout`, `acc`) → `'workout'`; `chevron={false}`; `trailing = <TrainingToggle size="sm"
  aria-label="Тренування сьогодні">`. Sub: null «Ще не відмічено» (muted) · planned today (onboarded, reminder on,
  weekday in days, null) «За планом о 18:00» `--accD` · true + types «Кардіо, Прес» (default `--ink2`) · true no
  types «Було · додай тип» `--accD` · false «Не було» (default `--ink2`). Model `subTone: 'muted' | 'acc' | undefined`
  (kit `Tone` has no `ink2`; undefined = ListRow's default sub colour). ✓ / ✕ → `setTrainedMark(today, v)`
  (`store/dayMarks.ts`): ✓ keeps types/food/notes + toast «Відмічено: тренування було»; ✕ clears types + «Відмічено:
  без тренування»; pressing the already pressed option or a refused save → nothing / no toast.
- **Вага** (`icon weight`, neutral) → `'weight'`. Sub «12 жовтня — 65,4 кг» · none «Ще немає зважувань» ·
  done today «✓ Сьогодні — 65,0 кг» (`--acc2D` prefix) · overdue «Пропущено · 12 жовтня — 65,4 кг» (`--accD` prefix).
  Value: due → `<Pill tone="acc" size="sm">Сьогодні</Pill>` · off «вимкнено» (muted) · else «Пн, 19 жовтня» / «Завтра» (soft).
  `aria-label` «Вага: останнє зважування 12 жовтня — 65,4 кг. Наступне: Пн, 19 жовтня · 08:00».
- **Заміри** (`icon measure`, neutral) → `'measure'`. Sub = only set params «Груди 90 · Талія 70 · Стегна 98»,
  none «Ще немає замірів», same ✓ / Пропущено prefixes and value states.
- **Тиждень** row: value «2 з 3 трен. · сер. 1 795 ккал» (no planned days «2 трен.», no kcal → kcal part dropped),
  `aria-label` «Тиждень: 2 з 3 тренувань, середня калорійність 1 795 ккал. Відкрити прогрес».
- Banner priority: setup (not onboarded) > install hint (iPhone Safari, not dismissed) > none. Reminder banners are
  gone; due/overdue are row states (suppressed until onboarded). Offline pill kept (role=status).
- Hero states: normal «35% шляху» / «до цілі 5,4 кг»; no weigh-ins «Ціль 60,0 кг» left and value «—»; **reached**
  right side «✓ Ціль досягнута» 15/700 **`--onSolid`** (not `--acc`: lavender on the light-grey dark-theme hero is ≈2:1).
- Removed: QuickAction grid, «Цей тиждень» tiles, «Поточні заміри», control rows card, KcalGoalLine on Home, hero tiles
  and the Старт/Ціль scale (start and goal stay on Progress; owner question Q9), the visible «Поточна вага» micro-label.
- Focus order: banner → «Відкрити день» → Їжа → Тренування → Було → Не було → Вага → Заміри → Тиждень → tab bar.

Desktop (≥ 1060px, `@media (min-width:1060px) and (hover:hover) and (pointer:fine)`): hero `grid-column:1`,
«Сьогодні» `grid-column:2; grid-row: span 2`, week `grid-column:1` (left 233px tall, right 302px). 900–1059px: all
three `grid-column: 1 / -1`. Sizes identical to the phone.

```
 ┌ sidebar 248 ┐ ┌──────────────────────── main ──────────────────────────┐
 │ Л Легко      │ │ Середа, 14 жовтня                                (Л)  │
 │ • Головна    │ │ Доброго ранку                                          │
 │   Календар   │ │ ┌──── hero (col 1) ────┐  ┌──── Сьогодні (col 2) ────┐ │
 │   Прогрес    │ │ │ 65,4 кг   (−2,9 кг)  │  │ Їжа                       │ │
 │   Налаштуван.│ │ └──────────────────────┘  │ Тренування      [✓] [✕]   │ │
 │ [+ Записати  │ │ ┌── Тиждень (col 1) ───┐  │ Вага                      │ │
 │     день ]   │ │ └──────────────────────┘  │ Заміри                    │ │
 └──────────────┘ └───────────────────────────┴───────────────────────────┴─┘
```

### 4.3 «+» menu and focused sheets (package `capture`)

```
 (backdrop)
 ~360 ┌──────────────── ▬ ────────────────────┐   Sheet heading «Що записати?» (dialog name), no date nav, no footer
      │ Що записати?                      (✕) │   58
      │ ┌───────────────────────────────────┐ │   ListGroup (no title) with 4 ListRow size lg
      │ │[F]  Їжа                1 240 ккал › │ │   72  sub «Опис або фото»
      │ │[T]  Тренування       (За планом)  › │ │   72  sub «Було чи ні, тип»
      │ │[W]  Вага              (Сьогодні)  › │ │   72  sub «Контрольне зважування»
      │ │[M]  Заміри                        › │ │   72  sub «Груди, талія, стегна»
      │ └───────────────────────────────────┘ │
      │              Повний запис дня →       │   ghost Button 44 → 'day', right-aligned under the chevrons
 844  └───────────────────────────────────────┘   ≈ 470 tall: rows at y≈420–716 (thumb zone)
```

Tap a row → `ui.openSheet(date, mode)`; the **same** dialog swaps heading, date navigator, footer and body (body fades
in 180ms `--ease-out`, translateY 6px→0; reduced motion → instant). Focus moves to the panel when it was dropped to
`<body>`. Menu closes without asking (nothing to lose). Menu statuses: Їжа «1 240 ккал» (`--accD` when over goal),
Тренування «✓ Було» / «✕ Не було» / Pill «За планом», Вага «65,4 кг» / Pill «Сьогодні», Заміри «✓ записано» / Pill
«Сьогодні» (due pills only for today and only after the first-run setup; same casing as Home's «Сьогодні» pill); Їжа
shows a soft «Записано» for food text or photos without kcal. «Повний запис дня →» is right-aligned under the rows'
chevrons, so the strip above the tab-bar «+» has no control (a double tap on «+» never opens the full day). A date line «13 жовтня · вівторок»
shows only for a day other than today. The new «drag the menu down closes it without asking» test lives in
`e2e/capture.spec.ts` (gestures.spec.ts is in flight in the food workflow, D24).

```
 Їжа (≈700)                                   Тренування (≈560–600)
 ┌──────────────── ▬ ─────────────────┐       ┌──────────────── ▬ ─────────────────┐
 │ Їжа                            (✕) │       │ Тренування                     (✕) │
 │ ‹   14 жовтня 2026   ›             │       │ ‹   14 жовтня 2026   ›             │
 │     середа · сьогодні              │       │     середа · сьогодні              │
 │ ┌ Сніданок, обід, вечеря…        ┐ │       │ [   ✓ Було   ] [  ✕ Не було   ]    │ 54
 │ └ (textarea, name «Що я їла»)    ┘ │       │ Тип                                │
 │ [thumbnails]                       │       │ (Верх тіла)(Низ тіла)(Кардіо)(Прес)│ 44
 │ [Порахувати] [Фото]  (FoodAssist)  │       │ (+ Свій тип)                       │
 │ Часті страви: (chips)              │       │ + Нотатка до дня                   │ ghost 44
 │ Калорії за день                    │       ├────────────────────────────────────┤
 │ [−50] [  1 240 ккал  ] [+50]       │       │ [            Зберегти            ] │ 56
 │ ███████░░  Залишилось 460 з 1 700  │       └────────────────────────────────────┘
 ├────────────────────────────────────┤
 │ [            Зберегти            ] │
 └────────────────────────────────────┘
```

- Їжа: only food text (no visible label), PhotoStrip md, `<FoodAssist>` (public props only), `KcalField` with goal.
- Тренування: `TrainingToggle lg` (group «Тренування»), Field «Тип» → TypePicker, notes folded as ghost «+ Нотатка
  до дня» (opens Field «Нотатки» and focuses it inside the tap; shown open when the day has notes).
- Вага / Заміри: unchanged. «Запис дня»: unchanged full form (Calendar, «Повний запис дня →», «Відкрити день →», `/?sheet=day`).
- Saving (all modes): writes only the fields the sheet shows, everything else from the store at save time (per-field
  merge in `recordOps`), `food.use` only when the food block is shown. Unsaved-changes guard unchanged.
- Desktop: the same centred 560px modal for menu and forms; FoodAssist's item editor stacks above (other workflow).

### 4.4 Settings «Налаштування» (package `settings`)

```
 Phone /settings (fits one screen, classic, Q8)      Phone /settings/reminders
 ┌───────────────────────────────────────────┐        ┌───────────────────────────────────────────┐
 │ Налаштування                  (h1 30/700) │ 45     │ ‹ Налаштування            (back link 44)  │
 │ (gap 14: the groups follow the header)    │        │ Нагадування                   (h1, focus) │
 │ ┌───────────────────────────────────────┐ │        │ ┌ Сповіщення на телефон (solid)  [Як?] ┐ │
 │ │                                       │ │        │ ┌ Тренування                 (switch)  ┐ │
 │ │[bell] Нагадування          3 увімк. › │ │ 60(+)  │ │ Пн Вт Ср Чт Пт Сб Нд · Час 18:00     │ │
 │ │       (Сповіщення вимкнені)  ← Pill   │ │        │ ┌ Контрольне зважування      (switch)  ┐ │
 │ │[tgt]  Цілі        60 кг · 1 700 ккал› │ │ 60     │ ┌ Заміри тіла                (switch)  ┐ │
 │ │[wk]   Типи тренувань         7 типів› │ │ 60     │   (existing cards, unchanged content)     │
 │ └───────────────────────────────────────┘ │        └───────────────────────────────────────────┘
 │ ┌───────────────────────────────────────┐ │
 │ │[moon] Вигляд                    Авто› │ │ 60     Desktop: ScreenHeader «Налаштування» + split
 │ │[data] Дані і копія  ● Синхронізовано› │ │ 60     ┌ list (sticky, 240–300px) ┐ ┌ detail (≤640) ────────┐
 │ └───────────────────────────────────────┘ │        │ Нагадування   3 увімк. ◄ │ │ h2 Нагадування         │
 │ ┌───────────────────────────────────────┐ │        │ Цілі  60 кг · 1 700 ккал │ │ NotificationsCard      │
 │ │[door] Вийти                 (--accD)  │ │ 60     │ Типи тренувань           │ │ ReminderCard ×3        │
 │ └───────────────────────────────────────┘ │        │ Вигляд / Дані і копія    │ └────────────────────────┘
 │         Легко · трекер схуднення          │        │ Вийти                    │  /settings = reminders detail
 └───────────────────────────────────────────┘        └──────────────────────────┘  selected row aria-current
```

- **Classic layout (owner decision Q8, overrides revision 2's «docked low»):** the `ScreenHeader` «Налаштування»
  and, right under it in normal flow (gap 14), the nav groups, «Вийти» and the caption. No min-height page wrapper,
  no `.bottom { margin-top: auto }`. e2e at 390×844: every row and «Вийти» are visible without scrolling and the
  first group starts ≤ 24px below the header.
- Rows are `ListRow href` (values `valueVariant="soft"`): «3 увімк.» / «Вимкнено»; «60 кг · 1 700 ккал»;
  «7 типів»; «Авто» / «Світла» / «Темна»; dot + «Синхронізовано» / «Синхронізую…» / «Очікує: 3» / «Офлайн · 1 зміна» / «Офлайн».
- Push problem badge (sub of the Нагадування row, `Pill sm`): default «Сповіщення вимкнені» (acc), denied
  «Сповіщення заборонені» (acc), needs-install «Потрібне встановлення» (acc), unsupported «Сповіщення недоступні»
  (neutral); none when enabled / still checking. The sub-page keeps the full NotificationsCard explanation + CTAs.
  One `usePushStatus()` **and one `useThemePref()`** lifted to SettingsScreen, shared by the list rows and the
  panels (D27; otherwise the desktop list keeps «Авто» after picking «Темна» in the pane).
- Desktop selected row: `ListRow current` → `--accT` background + `--accD` title (kit), clearly visible next to hover.
- «Вийти»: own group, `titleTone="accent"`, no chevron, same logout + `ui.confirm` logic («Виходжу…» after confirm).
- Sub-pages: `ScreenHeader back={{href:'/settings', label:'Налаштування'}} focusTitle={cameFrom(history.state,'/settings')}`;
  cards without their own CardHeader keep `section aria-label` («Мої цілі», «Мої тренування», «Вигляд», «Дані»).

### 4.5 Progress «Мій прогрес» (package `progress`)

```
 y
  12  Мій прогрес                                   45 (no subtitle)
  71  [ Тиждень | Місяць | 3 міс. | Весь час ]      48 PeriodBar: sticky top safe-top, --paper backdrop + 6px fade
 133  ┌ Цього тижня (tint --accT) ───────────────┐ ~130 one sentence line (SPEC §1.1 #7 wording, D22)
      │ Тренувань 2 · сер. калорійність 1 795 ккал│ numbers 17/700 deltaTone, words 15 --ink2,
      │ · вага −0,3 кг · талія −0,5 см · стегна   │ each «label number unit» nowrap, « · » --faint
      │ −0,5 см · груди 0 см                      │
 263  └──────────────────────────────────────────┘
 277  ┌ Вага                          35% шляху ┐ 314
      │ 65,4 кг   (−2,9 кг від старту)           │ 34/700 + Pill md (visible «від старту»)
      │ ██████████░░░░░░░░░░░░░░░░░░░░░░          │ ProgressBar sm
      │ Старт 68,3      ще 5,4 кг       Ціль 60,0│
      │ [LineChart 120]                          │
 591  └──────────────────────────────────────────┘ ← first screen ends here (tab bar 679), chart fully visible
      ┌ Заміри тіла ──── rows = chart selector ──┐ 358 (selected row --acc2T)
      ┌ Тренування ── StatStrip 4: 41·2·7·4 ─────┐ 228 + «Найчастіше · цього тижня» top 5
      ┌ Харчування          ціль 1 700 ккал ─────┐ 537 StatStrip 2 · BarChart · legend ·
      │ Історія калорій: 3 rows (Вт, 13 жовтня ● 1 740 ккал ›) · «Показати ще» +7
      total ≈ 1 885 (2.2 screens, was 2 470)

 Desktop: header | PeriodBar (full) | Summary full width (the same line, 1–2 lines) | Вага | Заміри | Тренування | Харчування
```

- Weight change Pill text is visible «−2,9 кг від старту» (tone `PillTone`: lost → `acc2`, gained → `acc`, flat →
  `neutral`); otherwise the summary's period «вага −0,3 кг» and the card's all-time «−2,9 кг» are two unlabelled deltas.

### 4.6 Calendar «Календар» (package `calendar`)

```
 y
  12  Календар                               [Сьогодні]   45 (outline sm, only away from today / its month)
  71  ┌ ‹        Жовтень 2026        › ───────────────┐  ~410
      │ Пн  Вт  Ср  Чт  Пт  Сб  Нд                     │
      │ 6 × cells 42px tall (gap 4), numbers 16/600     │  fills: mint food, lavender workout, dot weigh/measure
      │ ■ Їжа   ■ Тренування   ● Вага / заміри           │
 481  └────────────────────────────────────────────────┘
 495  ┌ 14 жовтня 2026                     (Частково) ┐  ListGroup titleSize lg (region «14 жовтня 2026»)
      │ середа · сьогодні                               │
      │ [F] Їжа                          1 880 ккал ›  │  60+ ; sub = food text (pre-line), thumbs below
      │     Омлет, борщ                                 │
      │     [thumb][thumb]                              │
      │ [T] Тренування                     [✓] [✕]     │  62  sub «Низ тіла, Прес» / «Не було» / «Ще не відмічено»;
      │     Низ тіла, Прес                              │      inline ✓/✕ = setTrainedMark(selected, v), same as Home
      │ [W] Вага                            65,4 кг ›  │  60
      │ [M] Заміри                           Додати ›  │  60 (empty → action word in --accD)
      │ [N] Нотатки                                 ›  │  only when there are notes
      │ [            Редагувати день            ]      │  outline md, «Заповнити день» when empty
 ~900 └────────────────────────────────────────────────┘
 No «Останні записи». Total ≈ 1.1–1.3 screens (was ~3).

 Desktop: header + «Сьогодні» | col 1 month card (cells aspect 1/0.86) | col 2 day card — fits one viewport.
```

- **Reveal the day after a cell tap.** The day card starts at ~495 and its rows at ~565, but the installed iPhone's tab
  bar top is 679, so only Їжа would be visible. After a cell tap (not on load with `?date=`, not on ‹ ›), the screen
  calls `dayCard.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })`; the card has
  `scroll-margin-bottom: calc(96px + var(--safe-bottom))` (tab bar 70 + 14 + 12 breathing) and `scroll-margin-top:
  calc(12px + var(--safe-top))`. `nearest` does nothing when the card is already visible (desktop, short days).
- **Accessible names keep the text.** Rows have short labels («Їжа: 1 880 ккал», «Нотатки») plus `describeSub` so the
  food text and the notes are the row's description (a bare `aria-label` would hide them from screen readers, §1.1 #2).
- The Тренування row has no «Відмітити» action word any more: the inline toggle replaces it (the calendar never selects
  a future day, `resolveSelected`). Label «Тренування: було, Низ тіла, Прес» / «Тренування: не було» /
  «Тренування: не відмічено»; the row button opens `'workout'` for the date.

---

## 5. Work packages

```
            ┌──────┐
            │ kit  │  (store/ui.ts SheetMode, ui/** primitives, e2e/support/app.ts)
            └──┬───┘
   ┌─────┬─────┼──────┬──────────┬──────────┬───────┐
 home  capture settings progress calendar  shell     (parallel, disjoint paths)
   └─────┴─────┴──────┴──────────┴──────────┴───────┘
                         │
                   ┌─────▼──────┐
                   │ e2e-visual │  (a11y, visual, cross-cutting specs, SPEC.md, full e2e run)
                   └────────────┘
```

| Package | Owned paths |
| --- | --- |
| kit | `apps/web/src/ui/icons/**`, `apps/web/src/ui/lists/**`, `apps/web/src/ui/tiles/StatStrip.*`, `apps/web/src/ui/internal/backNav.ts` (+ test), `apps/web/src/ui/layout/ScreenHeader.*`, `apps/web/src/ui/feedback/Banner.*`, `apps/web/src/ui/controls/TrainingToggle.*`, `apps/web/src/ui/controls/Button.module.css`, `apps/web/src/ui/controls/controls.test.tsx`, `apps/web/src/ui/index.ts`, `apps/web/src/ui/README.md`, `apps/web/src/ui/ui.test.tsx`, `apps/web/src/ui/kitStyles.test.ts`, `apps/web/src/store/ui.ts`, `apps/web/src/store/dayMarks.ts` (+ test), `e2e/support/app.ts` |
| home | `apps/web/src/screens/home/**`, `apps/web/src/lib/stats/reminders.ts`, `apps/web/src/lib/stats/reminders.test.ts`, `e2e/home.spec.ts` |
| capture | `apps/web/src/sheets/**`, `e2e/capture.spec.ts`, `e2e/day-record.spec.ts`, `e2e/deep-links.spec.ts`, `e2e/weight-measure.spec.ts` (NOT `gestures.spec.ts`, D24) |
| settings | `apps/web/src/screens/reminders/**` (removed), `apps/web/src/screens/settings/**`, `apps/web/src/App.tsx`, `packages/shared/src/api.ts`, `apps/server/src/push/messages.ts`, `apps/server/test/push.test.ts`, `apps/server/test/static.test.ts`, `apps/web/src/pwa/protocol.test.ts`, `e2e/reminders.spec.ts` (removed), `e2e/settings.spec.ts`, `e2e/backup.spec.ts` |
| progress | `apps/web/src/screens/progress/**`, `e2e/progress.spec.ts` |
| calendar | `apps/web/src/screens/calendar/**`, `e2e/calendar.spec.ts` |
| shell | `apps/web/src/shell/**`, `e2e/shell.spec.ts` |
| e2e-visual | `e2e/auth.spec.ts`, `e2e/sync.spec.ts`, `e2e/offline.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/README.md`, `docs/SPEC.md`; gated on the food workflow having landed (D24): `e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/gestures.spec.ts`, `e2e/food.spec.ts`, `e2e/__screenshots__/**`; plus test-only fixes of stale assertions in any `e2e/*.spec.ts` during the final gate (D26) |

Checks every package runs (from the repo root): `pnpm --filter @legko/web typecheck`, `npx eslint <owned paths>`,
`pnpm --filter @legko/web exec vitest run <owned test paths>`, and for e2e edits `npx tsc -p e2e/tsconfig.json --noEmit`.
No `pnpm install`, no builds, no dev servers, no Playwright except in `e2e-visual` (port 3399 is shared).
Errors in files owned by another package are reported, not fixed.

Interim note: between `kit` and `capture` landing, `SheetHost` falls through to the install sheet for the new modes
(`menu`/`food`/`workout`). Harmless during development; e2e only runs after every package has landed.

Per-package scope (full self-contained briefs are in the orchestration output):

- **kit** — §2 primitives + tests (ListRow link/button/static, trailing outside the action, describeSub, no empty-column
  gaps, Banner dismiss, TrainingToggle sm, ScreenHeader back/focus, backNav, StatStrip, Icon) + kitStyles contracts (row ≥
  56/72, back ≥ 44, banner ✕ ≥ 44, ghost ≥ 44, toggle 44×44, sub/value contrast ≥ 4.5 in both themes, aria-current
  title contrast, inset focus ring) + README + `SheetMode` + `store/dayMarks.ts` + e2e helpers (§3.5).
- **home** — new `homeModel` shape (banner | null, compact hero, 4 rows, week), `HOME_ROW_ACTIONS`, `setTrainedMark`,
  `weeklyCheck` / `weighCheck` / `measureCheck` in `lib/stats/reminders.ts`, rewrite HomeScreen/HeroCard/TodayCard,
  delete DismissibleBanner, desktop placement, unit tests, `e2e/home.spec.ts` incl. one-screen fit.
- **capture** — `'menu'`, `'food'`, `'workout'` in `sheets/record` (sections table, menuModel, CaptureMenu, blocks,
  in-place swap), SheetHost, deep links, «Перші кроки», copy pointing to «Налаштування», capture/day-record/deep-links/
  weight-measure specs (gestures.spec → e2e-visual).
- **settings** — move `screens/reminders` → `screens/settings`, list model, list/sub-page/desktop split, LogoutRow,
  headless cards, routes + `/reminders` redirect, server test-push URL, settings/backup specs.
- **progress** — PeriodBar, `?period=`, one-line summary, StatStrip workouts/nutrition, compact WeightCard with visible
  «від старту», placeholders with actions, 3-row history, progress spec.
- **calendar** — header «Сьогодні», DayCard as ListGroup of ListRows opening focused sheets, inline ✓/✕ on Тренування,
  reveal-on-tap scroll, remove History, «їжа» labels, calendar spec.
- **shell** — nav rename + gear, Icon instead of NavIcon, 3-part tab grid, NavLink pop-to-root, «+» → `'menu'` with
  `aria-expanded`, top padding 12, shell tests, `e2e/shell.spec.ts`.
- **e2e-visual** — a11y + visual + gestures specs (gated, D24), cross-cutting spec migrations (auth, sync, offline,
  onboarding, food), stale test-only assertions anywhere (D26), README, stale screenshots (never `53x-*`), SPEC.md (§7),
  full `pnpm e2e` + visual pass in light/dark, iPhone/desktop.

---

## 6. Requirements matrix (SPEC §1.1 → where it lives after the redesign)

| Requirement | Where |
| --- | --- |
| #1 Calendar: month grid, every day opens on its own; food text, kcal, workout yes/no with explicit «Не було», types, notes | Calendar month grid (unchanged fills, swipe, ‹ ›, `?date=`) → day check-list (Їжа text + kcal, Тренування ✓ types / «Не було», Вага, Заміри, Нотатки) → rows open focused sheets for that date; «Редагувати день» opens the full «Запис дня» with every field. Focused «Їжа» / «Тренування» sheets also take any past date (‹). |
| #2 History forever, any past day reopens with all fields | Calendar back without limit + `?date=`; day card shows every stored field unclamped + photos; Progress «Історія калорій» rows link to `/calendar?date=`; «Запис дня» for any date. |
| #3 Weekly weigh-in, date + kg, start/latest/difference/lost/dynamics | Вага sheet unchanged; Home hero (current, −lost, left) + Вага row (last «12 жовтня — 65,4 кг», next); Progress Вага card (Старт / current / Ціль / −lost / ще … / chart by period) + summary «Вага, кг» per period. |
| #4 Weekly measurements, change from first values | Заміри sheet unchanged; Home Заміри row (current values); Progress «Заміри тіла» rows «74,5 → 70 см −4,5 см» + chart per parameter. |
| #5 Reminders (workout days + time, weigh-in, measurements), real push | Settings → Нагадування sub-page (NotificationsCard + 3 ReminderCards unchanged), row summary «3 увімк.» + push-problem badge; server scheduler unchanged; workout push `/?sheet=day&trained=1` opens «Тренування» with ✓; due states visible in Home rows. |
| #6 «Мій прогрес»: weight start/current/goal/lost/left/chart; measurements start→current, delta, chart per param; workouts total/week/month/top types; nutrition kcal/day, avg week, avg month, browsable history | Progress: WeightCard; MeasuresCard; WorkoutsCard StatStrip (Всього · Цього тижня · Цього місяця · В сер. / тиж.) + «Найчастіше» top 5; NutritionCard BarChart (daily / weekly averages) + StatStrip «Сер. цього тижня» / «Сер. цього місяця» + «Історія калорій» (3, «Показати ще» +7). |
| #7 Automatic summary for week / month / 3 months / all | Sticky PeriodBar + tint summary as one sentence line in the SPEC's own wording: «Тренувань 2 · сер. калорійність 1 795 ккал · вага −0,3 кг · талія −0,5 см · стегна −0,5 см · груди 0 см» (rangeStats unchanged). `/progress?period=`. |
| #8 Each day its own record; calendar shows filled / workout / weigh-in-measurements done | recordOps per-field merge (focused sheets never clobber other fields); calendar fills + dot + legend («Їжа»); day status Pill «Заповнено / Частково / Порожньо». |
| #9 Home: current weight, lost, left, current measurements, workouts this week, avg kcal, last weigh-in, next weigh-in, next measurements, quick «+ Харчування / + Тренування / + Вага / + Заміри» | Hero «65,4 кг», badge «−2,9 кг» (sr «Втрачено від старту»), «до цілі 5,4 кг»; Заміри row values; week row «2 з 3 трен. · сер. 1 795 ккал»; Вага row sub (last) + value (next, full time in aria-label); Заміри row value (next); quick add = each Home row (one tap to its focused sheet) + «+» menu with the same four actions. |
| #10 Ease of use: phone first, minimal typing, big targets, quick ✅/❌, food, kcal, weight, measurements, notes | Home fits one screen (~43px slack); inline 44×44 ✓/✕ saves in one tap on Home and on any past day in the calendar; rows 60–72px; short sheets show only one action's fields; notes via «+ Нотатка до дня» / «Відкрити день» / «Повний запис дня»; primary rows in the lower 2/3; inputs ≥ 16px. |
| Additions: login, first-run setup, install guidance, test notification, custom types, theme, JSON backup, offline queue, AI estimate + photos + «Часті страви» | Login unchanged; setup sheet «Перші кроки» + compact «Почнімо» banner; install hint = single dismissible compact banner + «Як?» in Settings → Нагадування; «Тест» in the panel (`/settings/reminders` URL); types on `/settings/workouts`; theme on `/settings/appearance`; backup/restore on `/settings/data`; sync state in the Дані row + sub-page; offline pill on Home; AI estimate / photos / chips inside the «Їжа» sheet and «Запис дня» via FoodAssist (unchanged, other workflow). |
| §2 design: 1b tokens, Manrope, radii, light + dark, reduced motion, safe areas | Kit + screens use tokens only; icon squares use T/D token pairs; new motion = 120ms row background, 180ms sheet body swap, 160ms calendar fade — all killed by the global reduced-motion rule. |

---

## 7. SPEC.md update (applied by `e2e-visual`)

**§2 Layout, replace the Mobile/Desktop bullets' affected parts with:**

- Mobile: column `max-width: 440px`, padding `calc(12px + safe-top) 18px calc(120px + safe-bottom)`; floating glass
  tab bar: **Головна · Календар · + · Прогрес · Налаштування** in a 3-part grid (`minmax(0,1fr) 64px minmax(0,1fr)`,
  labels 11/600, 10px below 360px); «+» opens the «Що записати?» menu.
- Desktop: unchanged container/sidebar/grid; the sidebar's «+ Записати день» opens the same menu. (The «quick buttons in
  4 columns» line is obsolete.)

**§2 new subsection «2.1 Redesign A «Чек-лист дня» (deliberate deviation from the prototype layout)»:**

The visual language stays 1b (tokens, Manrope, radii, colours, light/dark); the prototype's **layout** is replaced:
Home is one phone screen — header, compact hero (current weight, signed change badge, progress bar, «N% шляху»,
«до цілі X кг»), one «Сьогодні» list of four action rows (Їжа, Тренування with inline ✓/✕, Вага, Заміри; due /
missed / done states live in the rows) and one week row linking to `/progress?period=week`; at most one compact banner
(setup > iPhone install hint). «+» opens «Що записати?» (four 72px rows + «Повний запис дня →»), each row opens a short
sheet with only that action's fields in the same dialog; «Запис дня» stays for full editing (calendar, «Відкрити день»).
Settings is an iOS-style grouped list with summaries (`/settings`) and sub-pages (`/settings/reminders|goals|workouts|
appearance|data`) with an in-app «‹ Налаштування» back; re-tapping the active tab pops to the list; push problems show
as a badge on the Нагадування row; desktop shows list + detail. Progress has a sticky period bar with a paper backdrop,
the summary as one sentence line (the §1.1 #7 example wording), unboxed stat strips instead of tile grids. The calendar
is month grid + the selected day as a check-list whose rows open short sheets for that date (inline ✓/✕ for the
workout, as on Home); «Останні записи» is removed. Shared row primitives: `ListGroup` / `ListRow` (60px, 72px in the
menu), `Icon`, `StatStrip` (see `apps/web/src/ui/README.md`). Plan: `docs/redesign-a.md`.
§1.1 #9 «quick buttons «+ Харчування / + Тренування / + Вага / + Заміри»» are satisfied by the four «Сьогодні» rows
(one tap → that action's short sheet; Тренування also has inline ✓/✕) and by the «+» menu with the same four actions;
there is no separate button grid.

**§3.3:** test notification url → `/settings/reminders`.

**§3.5:** routes `/`, `/calendar?date=YYYY-MM-DD`, `/progress[?period=week|month|q|all]`, `/settings`,
`/settings/:section` (reminders | goals | workouts | appearance | data), `/reminders` → redirect to
`/settings/reminders`; screens export `HomeScreen`, `CalendarScreen`, `ProgressScreen`, `SettingsScreen`
(`screens/settings`). UI state: `SheetMode = 'menu' | 'day' | 'food' | 'workout' | 'weight' | 'measure' | 'setup' |
'install'`. Deep links: `/?sheet=day&trained=1` opens «Тренування» with ✓ (legacy alias kept for delivered pushes),
`/?sheet=day` the full day, `/?sheet=food`, `/?sheet=workout[&trained=1]`, `/?sheet=weight`, `/?sheet=measure`.

**§3.6:** kcal history shows 3 days, «Показати ще» loads 7 more; the type ranking shows the top 5. «Next weigh-in /
measurements»: on Home the date is shown without the time («Пн, 19 жовтня» / «Завтра»; the « · HH:MM» time is part of
the row's accessible name), due today shows a «Сьогодні» pill; `nextReminderLabel().text` keeps the time for other
uses. Home weigh-in / measurement rows also show «✓ Сьогодні» when done today and «Пропущено ·» when the last
scheduled day in the past 6 days was missed after an earlier record (`weeklyCheck`).

---

## 8. Risks

1. **Concurrent food/sheet workflow.** `ui/sheet/**`, `features/food/**`, `ui/README.md` and four e2e specs —
   `e2e/food.spec.ts`, `e2e/a11y.spec.ts` (+74 lines: estimate list / item editor targets), `e2e/visual.spec.ts` (+64:
   shots 531–537) and `e2e/gestures.spec.ts` (+42: item-editor drag) — have uncommitted edits. Kit edits README/index.ts
   in place only, never the Sheet section; all four specs and `__screenshots__/**` are touched only when `git status
   --porcelain <file>` is empty (D24), their food-workflow tests and shots are kept. Those tests open the day sheet via
   Home «Відкрити день» in region «Сьогодні», which this plan keeps. Capture's post-swap focus (panel focus only when
   focus fell to `<body>`) must be re-verified against the new stack/focus code.
2. **In-place menu → form swap** depends on SheetHost rendering `RecordSheet` at the same tree position, never keyed by
   mode. A unit test asserts the same dialog element before/after.
3. **One-screen Home is tight**: ~624px of content vs 667px available (iPhone 14 installed), ~43px slack after the
   revision-2 trims. Two extra sub lines still fit; the offline pill (~30) or a 2-line banner (~86) can push the week row
   under the bar; iPhone SE / 13 mini scroll a little; text zoom scrolls (no fixed heights). Guarded by `home.spec` fit
   tests at 390×763 with the demo seed AND a worst-case seed (decimal measurements 92,5 / 74,5 / 100,5 and today
   trained with «Верх тіла», «Низ тіла»), plus row-title no-wrap checks at 375 and 320.
4. **Instant ✓** creates more workout days without types (thinner «Найчастіше»); mitigated by «Було · додай тип». Q1.
5. **e2e churn** across ~15 specs. Mitigated by kit-owned helpers with type-compatible shims (not behaviour-compatible),
   stable names (regions «Сьогодні», «Поточна вага», «7 жовтня 2026»; buttons «Відкрити день», «Було», «Не було»),
   listed stale lines in the owners' briefs, e2e-visual's right to fix test-only stale assertions (D26) and one final
   e2e run.
6. **History-state back** (`legkoFrom`) relies on wouter `Link state`; if state is lost, back falls back to a replace
   navigation (works, one extra history entry). Both branches unit-tested.
7. **Tab grid width** uses Manrope metrics without kerning (±1px); `e2e/shell.spec.ts` checks 320/375/390.
8. **Interim SheetHost fall-through** for new modes until capture lands (dev only).
9. **Dead kit code** (QuickAction, StatTile, Tile, Section, DetailRow, parts of KeyValueRow/Card/BarRow/Segmented)
   stays until the follow-up prune.
10. **Removed content**: Home start/goal scale, Calendar «Останні записи», kcal «Період» tile, 7 → 3 history rows,
    150 → 120px weight chart, top-5 types. All §1.1 items remain (matrix); owner questions cover each.
11. **Overdue semantics are new** (client-only); needs a record before the missed day so new users are never nagged.
12. **Desktop heading levels differ** (phone sub-page h1 = section; desktop h1 «Налаштування» + h2 section) — e2e
    looks headings up by name.

---

## 9. Owner questions (для владельца)

1. «✓ Було» в строке «Тренування» на главной: сохранять сразу одним тапом (тип можно добавить позже, тапнув по строке —
   там будет «Було · додай тип»), или после ✓ сразу открывать короткое окно с типами?
2. Напоминание о тренировке (пуш «Час тренування») — открывать короткое окно «Тренування» с уже выбранным «✓ Було»
   (предлагаем) или по-старому полную форму дня?
3. Заметки дня: свёрнутая «+ Нотатка до дня» в окне «Тренування» + «Відкрити день →» на главной + «Повний запис дня →»
   в меню «+». Так удобно, или нужна пятая строка «Нотатки» в меню «Що записати?»?
4. Пропущенное взвешивание/замеры (был понедельник, сегодня среда): показывать мягкую пометку «Пропущено ·» в строке
   или достаточно следующей даты?
5. Строка недели «2 з 3 трен. · сер. 1 795 ккал» — понятно, или лучше «~1 795 ккал/день»?
6. Первое окно настройки сейчас называется «Налаштування», как новая вкладка. Переименовать в «Перші кроки»?
7. Вкладка «Налаштування» шире обычного слота; оставляем полное слово (боковые слоты чуть неравные, «+» строго по
   центру) или назвать «Параметри»?
8. Список настроек: прижать группы к низу экрана, ближе к большому пальцу (предлагаем), или классически сразу под
   заголовком?
9. На главной больше нет стартового веса и цели (остаются «−2,9 кг», «35% шляху», «до цілі 5,4 кг»; старт и цель — на
   «Прогрес»). Подходит?
10. «Історія калорій» на «Прогрес»: 3 последних дня + «Показати ще» (страница короче) или неделя (7 строк) как сейчас?
    И график веса 120px (как у замеров) или оставить 150px?
11. Убираем из календаря список «Останні записи» (день читается в карточке под сеткой, ккал по дням — в «Прогрес»).
    Ок? И везде «Їжа» вместо «Харчування» (легенда, главная, меню)?
12. В коротком окне «Їжа» после «Додати N ккал» всё ещё нужно нажать «Зберегти» (можно поправить текст и ккал).
    Оставить так или сохранять сразу?
13. В календаре у строки «Тренування» выбранного дня теперь те же кнопки ✓/✕, что на главной: отметить вчерашнюю
    тренировку можно одним тапом, без окна. Так удобно, или в календаре лучше только через окно?
14. Сводка на «Прогрес» теперь одна строка-предложение («Тренувань 2 · сер. калорійність 1 795 ккал · вага −0,3 кг …»),
    как в примере из требований, вместо таблицы из 6 чисел. Читается нормально?

---

## 10. Follow-ups (after this redesign has merged)

- Kit prune (one agent, sequential): delete `QuickAction`, `StatTile`, `Tile`, `Section` (keep `SectionTitle`: it
  names the desktop Settings pane), `DetailRow`
  if unused, KeyValueRow `control`/`summary` variants, Card `list` variant, BarRow `history`, Segmented `sticky`, the
  deprecated e2e shims (`quickAction`, `LegacySection 'Нагадування'`, SheetName `'Налаштування'`), `lib/stats
  recentDays` if unused; update README/tests.
- Optional: lavender dot on the «Налаштування» tab when push is off in the installed app (needs a shared push-status store).

---

## 11. Review log (revision 2) — accepted critique, verified against the code

| # | Issue (reviewer) | Verified | Fix applied |
| --- | --- | --- | --- |
| R1 | Food workflow also edits a11y/visual/gestures specs (1, 3) | `git status`: ` M e2e/a11y.spec.ts` (+74), ` M e2e/visual.spec.ts` (+64, shots 531–537), ` M e2e/gestures.spec.ts` (+42) | D24: all four specs + `__screenshots__/**` gated; gestures migration moved capture → e2e-visual; menu drag test in capture.spec; 53x shots kept |
| R2 | Desktop Settings theme summary goes stale (1) | `lib/theme.ts` `useThemePref` = per-component `useState` | D27: one `useThemePref()` in SettingsScreen, passed down; desktop unit test |
| R3 | Nobody fixes stale assertions; shims not behaviour-compatible (1) | `backup.spec.ts:159-161`, `reminders.spec.ts:161-162`, `day-record.spec.ts:17,80,86,212-213`, `offline.spec.ts:46,57`, `backup.spec.ts:225` | D20 wording «type-compatible»; D26 e2e-visual may fix test-only stale lines; lines listed in settings/capture briefs |
| R4 | Settings docked list overflows ~51px (1, 2) | ScreenHeader 8+33+4 = 45, grid gap 14, main padding 12/120 | Header inside `.page`; document = 100dvh − 8 |
| R5 | aria-labels hide food text / notes; «Записано» label contradicts (1) | `ListRow` aria-label replaces content; `kcalGoalView` → 'empty' for text-only | Kit `describeSub`; calendar uses it on food/notes; Home «Їжа: записано, калорії не вказані…» |
| R6 | SPEC §3.6 « · HH:MM» and §1.1 #9 quick buttons out of step (1) | `SPEC.md` §3.6 and §1.1 #9 | §7 adds the §3.6 note and the §1.1 #9 mapping in §2.1 |
| R7 | Home budget miscounted (2) | ghost `.ghost { padding: 8px 0 }` = 35px header button; list padding 8 + border 2; hero ~172 | Hero label hidden + padding 16, header `12px 16px 2px`, `flush` week group, `column-gap: 0`; 624/667; worst-case fit test |
| R8 | Ghost button hit area 43px (2) | `Button.module.css` `.ghost::after { inset: -4px -6px }`; `TodayCard.module.css:1` patch | Kit owns Button.module.css: `inset: -5px -6px` (45) + kitStyles contract |
| R9 | Compact banner cuts the setup sub (2) | ~184px text column at 390 vs 57 chars at 13px | Sub 3-line clamp (none below 360px), shorter setup sub; e2e no-clipping check at 390 and 320 |
| R10 | «Ціль досягнута» ≈2:1 in dark (2) | dark `--solid #e9edf2`, `--acc oklch(0.74 0.11 290)` | «✓ Ціль досягнута» in `--onSolid`; dark-mode unit/visual case |
| R11 | Calendar day card under the tab bar after a tap (2) | §4.6: rows start ~565, tab bar top 679 | `scrollIntoView({ block: 'nearest' })` on cell taps + scroll-margins; e2e at 390×763 |
| R12 | Progress summary still a 6-cell table (2) | SPEC §1.1 #7 example is a sentence; strip repeats WorkoutsCard/NutritionCard | D22: one sentence line |
| R13 | ListRow keeps 14px gaps for empty columns (2) | CSS grid gaps sit between all explicit tracks | `column-gap: 0` + margins; ≤359px compaction; toggle gap 6; e2e at 375/320 |
| R14 | Home «Записано / 1 700 ккал» with an empty meter (2) | `e2e/fixtures/data.ts:12` today = food only, no kcal | recorded: no goal span / meter, sub «Калорії не вказані»; e2e-visual brief corrected |
| R15 | Progress weight pill hides «від старту» (2) | the «Втрачено» tile is removed | Visible «−2,9 кг від старту» |
| R16 | Training mark / casing inconsistent (2) — partly | Calendar «Відмітити» opened a sheet; menu pills lower-case | Calendar inline ✓/✕ via `store/dayMarks.ts`; pills «Сьогодні» / «За планом» (label rename rejected, §12) |
| R17 | Desktop selected settings row invisible (2) | `--line2` on `--card` ≈1.1:1 | `[aria-current]` → `--accT` + `--accD` title |
| R18 | Section type breaks `heading('Нагадування')`; SheetName doc (3) | `e2e/auth.spec.ts:49`; `app.ts` `heading(section: Section)` | `LegacySection` for go/heading; SheetName keeps deprecated 'Налаштування' in §3.5 |
| R19 | ScreenHeader back calls a hook in onClick (3) | brief: `onClick → useBackTo(href)(e)` | Private `BackLink` component |
| R20 | `subTone: 'ink2'` is not a Tone (3) | `ui/tone.ts` Tone = ink, acc, acc2, muted, faint | model type: 'muted', 'acc' or undefined (= default `--ink2`) |
| R21 | WeightCard Pill tone 'ink' not a PillTone (3) | `Pill.tsx` PillTone = acc, acc2, neutral, accSolid | `PillTone`, flat → 'neutral' |
| R22 | ListGroup `titleId ?? useId()` conditional hook (3) | rules-of-hooks (eslint-plugin-react-hooks ^7.1.1) | ids from top-level `useId()` |
| R23 | backup.spec `settingsBack()` on desktop (3) | desktop pane has no back link; spec runs in both projects | `gotoSettings`/`openSettings`; settingsBack tests gated to iphone |
| R24 | Settings «≥ 1/3» check fails with the badge (3) | `lib/push.ts:79` iPhone UA → 'needs-install'; list ~458px | Superseded by Q8 (classic list): no-scroll + «first group ≤ 24px under the header» assertions (§4.4) |
| R25 | a11y «full card width» impossible for the Тренування row (3) | trailing toggle is a sibling | Full width only for Їжа/Вага/Заміри; Тренування = button + toggle span the card |

---

## 12. Rejected critique

- **«‹ Інше» back-to-menu link in focused sheets (reviewer 2, low):** rejected — it saves one tap on a mis-tap (✕ or drag
  down, then «+») but adds a control and a `fromMenu` state to every focused sheet, against the owner's «less clutter»;
  typed input is already protected by the unsaved-changes guard.
- **One label for the full-day sheet («Весь день →» on Home and in the menu) (reviewer 2, part of a low item):**
  rejected — «Відкрити день» in region «Сьогодні» is the stable name used by the concurrent food workflow's in-flight
  tests (gestures/a11y/food specs) and by D4; «Повний запис дня →» in the menu and «Редагувати / Заповнити день» in
  the calendar are deliberately contextual (record action vs. a selected day). The calendar toggle and the pill casing
  from the same item were accepted (R16).
