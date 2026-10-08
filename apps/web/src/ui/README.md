# UI kit (`@/ui`)

Reusable pieces extracted from `design/handoff/Tracker.dc.html` (variant **1b «Свіжість»**). Every size, padding,
gap, font size/weight, letter-spacing, radius and colour below is copied from the prototype; colours and radii come
only from `styles/tokens.css`. Line numbers refer to `Tracker.dc.html`.

```tsx
import { Card, CardHeader, Tile, Button, Sheet, useRetained, deltaTone } from '@/ui';
```

General rules

- Import from `@/ui` only (not from sub-folders).
- Every component accepts `className` (merged last). If you override a property the component sets, make sure your
  CSS module is imported after `@/ui` (it is when you import `@/ui` first) or raise specificity.
- Values are passed **formatted** (`f1`, `fN`, `f0`, `sgn`, `dLong`… from `@legko/shared`). Components never format.
- `Tone` = `'ink' | 'acc' | 'acc2' | 'muted' | 'faint'` → text colour `--ink`, `--accD`, `--acc2D`, `--muted`, `--faint`.
  `deltaTone(n)` ports the prototype `tone()`: `< −0.04` → `acc2` (mint), `> 0.04` → `acc` (lavender), else `ink`.
- `cx(...classes)` joins class names (falsy values skipped).
- Grid children are one column wide; use `full` (where offered), `<FullRow>` or `className={fullRowClass}` to span
  both desktop columns (`grid-column: 1 / -1`).

---

## Layout

### `ScreenHeader` — lines 35–41, 140–145, 211–214, 352–355

`{ title, subtitle?, right?, className? }`. Subtitle 14 muted above an `<h1>` title (display 30/700, −0.025em,
line-height 1.1); column gap 4; row `space-between`, `align-items: flex-end`, padding `8px 4px 4px`; always full width.
Home: `<ScreenHeader subtitle="Субота, 10 жовтня" title={greeting()} right={<Avatar />} />`.

### `ContentGrid` — lines 34, 139, 210, 351 (`cols` in `renderVals`)

`<div>` props. 1 column below 900px, `repeat(2, minmax(0,1fr))` from 900px (same breakpoint as `useIsDesktop`),
gap 14, `align-items: start`. Also exports `FullRow` (div spanning all columns) and `fullRowClass`.

### `Avatar` — line 40

`{ letter? = 'Л', label?, className? }`. 44px circle, `--accT` background, letter 700 in `--accD`. Decorative unless `label`.

## Surfaces

### `Card` — lines 54, 72, 111, 127, 174, 221, 231, 356, 365

`{ variant?, gap?, row?, full?, as?: 'div'|'section'|'article', ...div props }`

| variant   | look                                                                      | prototype                                |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| `default` | `--card`, 1px `--line` border, `--r24`, padding 18, gap 14                | «Сьогодні», «Вага», reminder cards       |
| `hero`    | `--solid` bg, `--onSolid` text, `--r28`, padding `22px 22px 20px`, gap 18 | «Поточна вага» (54)                      |
| `solid`   | `--solid` bg, `--onSolid` text, `--r24`, padding 18, gap 14               | «Сповіщення на телефон» (356, use `row`) |
| `tint`    | `--accT` bg, `--r24`, padding 18, gap 4, no border                        | summary «Цього тижня» (221)              |
| `list`    | like default but padding `6px 18px`, gap 0                                | Home control rows (127)                  |

`gap` ∈ `0 2 4 6 8 10 12 14 18` overrides the variant gap (calendar details use `gap={6}`, «Заміри тіла» and
«Мої цілі» `gap={12}`). `row` → `flex-direction: row; align-items: center`. Calendar month card (padding
`16px 14px 14px`, gap 12) and the «Останні записи» list (padding `4px 16px`) need a `className` override.

### `CardHeader` — lines 73–76, 113–115, 175–181, 308–311, 366–371

`{ title, subtitle?, meta?, right?, size?: 'sm'|'md'|'lg', align?: 'center'|'baseline'|'start', as?: 'h2'|'h3', titleId?, className? }`

- `md` (default): display 18/700, −0.01em.
- `sm`: 17/700 + subtitle 13 muted (reminder cards: `right={<Switch …/>}`, «Мої цілі»).
- `lg`: 20/700, −0.015em + subtitle 14 muted, gap 10 (calendar details: `align="start"`, `right={<Pill …/>}`,
  add `className` with `padding-bottom: 6px`).
- `meta`: 13 muted text on the right («ціль 1 700 ккал» with `align="baseline"`, «5 жовтня»).
- `right`: any node, e.g. `<Button variant="ghost">Відкрити день →</Button>`.
  Row `space-between`, gap 12, title/subtitle column gap 2. The tint summary title has `padding-bottom: 6px` (className).

### `SectionTitle` / `Section` — lines 99–100, 191–192

`SectionTitle { children, id?, as?, className? }`: display 18/700, −0.01em, padding `6px 4px 0`.
`Section { title, children, gap?: 8 | 10 (default 10), full?, className? }`: `<section>` column = title + content.
«Цей тиждень» → `<Section title="Цей тиждень">`, «Останні записи» → `<Section title="Останні записи" gap={8} full>`.

## Tiles & rows

### `Tile` — lines 67–68, 78–79, 118–122, 235–238, 288–291, 314–317

`{ label, value, sub?, subTone? = 'acc2', tone?, variant?, onClick?, 'aria-label'?, className? }` — paper tile inside cards.

| variant             | label               | value                         | radius / padding                      | used for                                     |
| ------------------- | ------------------- | ----------------------------- | ------------------------------------- | -------------------------------------------- |
| `compact` (default) | 12 muted            | 18/700                        | `--r14`, `10px 12px`                  | Progress weight & kcal tiles                 |
| `count`             | 12 muted            | 22/700                        | `--r14`, `12px`                       | Progress workout tiles                       |
| `entry`             | 13 muted            | 16/600, gap 3                 | `--r16`, `12px 14px`                  | Home «Харчування / Калорії» (pass `onClick`) |
| `measure`           | 13 muted            | 22/700, −0.02em; `sub` 13/600 | `--r16`, `12px`                       | Home «Поточні заміри» (`sub="−4 см"`)        |
| `onSolid`           | 13 `--onSolidMuted` | 20/600                        | `--r16`, `12px 14px`, bg `--solidSub` | hero «Втрачено / До цілі»                    |

With `onClick` the tile is a `<button>`. Tiles don't lay themselves out: wrap them in your own grid
(`1fr 1fr` gap 10, or `repeat(3, minmax(0,1fr))` gap 8, as in the prototype).

### `StatTile` — lines 103–106

`{ label, value, unit?, tone? = 'ink', className? }`. `--card`, border `--line`, `--r20`, padding `14px 16px`, gap 4;
label 13 muted; value 24/700 (−0.02em) in `tone`; unit 14/500 muted after a space. Home «Цей тиждень».

### `KeyValueRow` — lines 129–132, 224–227, 388–395

`{ label, value, variant?, tone?, className? }`

- `control` (default): label 14 muted, value 15/600 right-aligned, padding `13px 0`, `--line2` divider below,
  none after the last row. Put them in `<Card variant="list">`.
- `summary`: label 15 `--ink2`, value 16/700 in `tone`, padding `8px 0`, `--accLine` divider above each row. In `<Card variant="tint">`.
- `plain`: label 15 `--ink2`, `value` rendered as-is (e.g. `<Stepper …/>`), no divider. «Мої цілі».

### `DetailRow` — lines 183–186

`{ label, value, className? }`. Grid `104px minmax(0,1fr)`, gap 12, padding `11px 0`, `--line2` divider above;
label 14 muted; value 15/500, line-height 1.4, wraps. `null` / `''` / `'—'` render a `--faint` «—».

### `BarRow` — lines 297–301, 339–343

`{ label, value, pct, variant?: 'rank'|'history', tone?: 'acc'|'acc2' (default 'acc'), onClick?, 'aria-label'?, className? }`

- `rank`: grid `92px / 1fr / 28px`, gap 10; label 14/500; 10px bar (`--line2` track); value 14/700. «Найчастіше».
- `history`: grid `96px / 1fr / 78px`, gap 10, padding `9px 0`, `--line2` divider above; label 14; 6px bar; value
  14/600. «Історія калорій»: `tone={item.tone === 'over' ? 'acc' : 'acc2'}`, `onClick` → open that day.

## Controls

### `Button` — lines 28, 50, 75, 188, 361, 506

`{ variant?, size?, fullWidth?, ...button props }` (`type="button"` by default; `:active` scale .98; disabled = opacity .45)

- variants: `solid` (default; `--solid`/`--onSolid`), `accent` (`--acc`/`--onAcc`, 700, nowrap), `outline` (`--card` +
  1px `--line`, ink), `ghost` (transparent, muted 14/500, padding `8px 0`; tap area grown invisibly to 44px; ignores `size`).
- sizes: `sm` 14/600, padding `10px 14px`, `--r12`, min-height 40 (44 for `accent`) — banner CTA, notifications CTA;
  `md` (default) 15/600, `--r14`, min-height 50 — «Редагувати день» (add `margin-top: 8px`);
  `lg` 16/700, `--r16`, min-height 56 — sheet «Зберегти» (`fullWidth`).

### `IconButton` — lines 148/150, 391/393, 435/437

`{ label (aria-label, required), children (glyph), surface?: 'paper'|'card', shape?: 'nav'|'step', ...button props }`.
44×44, 1px `--line` border, ink glyph. `nav`: `--r14`, 18px («‹ ›»). `step`: `--r12`, 20px («− +»). `disabled` → `--faint`.

### `StepNav` — lines 147–151, 434–438

`{ children, onPrev, onNext, prevLabel, nextLabel, canPrev? = true, canNext? = true, surface?: 'paper'|'card', className? }`.
«‹ centre ›» row (`space-between`). Calendar: `surface="paper"`, centre = month title (display 17/700, your class),
`className` with `padding: 0 4px`, `canNext={!isCurrentMonth}`. The sheet uses it internally.

### `TrainingToggle` — lines 84–85, 446–447

`{ value: boolean | null, onChange(trained: boolean), size?: 'md'|'lg', 'aria-label'?, 'aria-labelledby'?, className? }`.
Grid `1fr 1fr` gap 10; buttons 600, border 1.5px. `md` (Home): 15px, `--r14`, min-height 50. `lg` (sheet): 16px,
`--r16`, min-height 54. «✓ Було» selected → `--accT` + `--acc` border; «✕ Не було» selected → `--solid` bg,
`--onSolid` text, `--ink` border; unselected → `--card` + `--line`. `aria-pressed` on both; `onChange` fires on every
press (Home «✓ Було» opens the sheet even if already marked). Group name: Field label, else «Тренування».

### `Chip` / `ChipGroup` — lines 450–453

`Chip { selected, children, ...button props }`: pill, 1.5px border, 600 14, padding `0 16px`, min-height 44;
selected → `--accT` / `--accD` / `--acc` border, else `--card` / ink / `--line`. `aria-pressed`.
`ChipGroup { children, 'aria-label'?, 'aria-labelledby'?, className? }`: wrapping row, gap 8 (`role="group"`, labelled by the Field).

### `Segmented` — lines 215–218

`{ options: {value, label}[], value, onChange, 'aria-label' (required), sticky?, full?, className? }` (generic over the value).
Track `--line`, padding 4, `--r16`, equal columns, gap 4. Items min-height 40, `--r12`, 13/600; active → `--card`, ink,
`--shadow-seg`; else transparent / muted. `role="radiogroup"` + `role="radio"`, roving tabindex, ←/→/Home/End.
`sticky` → `position: sticky; top: calc(8px + safe-top); z-index: 5`. Progress: `<Segmented full sticky aria-label="Період" …/>`.

### `Switch` — line 371

`{ checked, onChange(next), 'aria-label'? | 'aria-labelledby'?, 'aria-describedby'?, disabled?, id?, className? }`.
52×32 pill, padding 3; on `--acc2`, off `--line3`; knob 26 `--knob` with `--shadow-knob`, slides 20px.
`role="switch"` + `aria-checked`; tap area extended to 44px.

### `WeekdayPicker` — lines 373–376

Discriminated by `mode`:

- `{ mode: 'multi', value: Weekday[], onChange(days: Weekday[]) }` — toggle buttons (`aria-pressed`); result sorted Monday-first.
- `{ mode: 'single', value: Weekday, onChange(day: Weekday) }` — radio group with arrow keys.
  Common: `'aria-label'` (required), `disabled?`, `className?`. Grid of 7 (gap 5), Monday first, labels «Пн…Нд»
  (accessible names «Понеділок…»). Buttons min-height 44, `--r12`, 13/600, 1.5px border; selected → `--solid` /
  `--onSolid` / `--ink` border, else `--card` / ink / `--line`. For the «off» state the prototype dims the picker and the
  time row with `opacity: .45` — do that in the screen. Also exports `toggleWeekday(days, day)`.

### `Stepper` — lines 390–394

`{ value (formatted), onDecrement, onIncrement, decrementLabel? = 'Зменшити', incrementLabel? = 'Збільшити', canDecrement?, canIncrement?, 'aria-label'?, className? }`.
`IconButton shape="step"` (paper) − value (display 17/700, min-width 96, `<output aria-live>`) +; gap 6.
Use with `<KeyValueRow variant="plain" label="Цільова вага" value={<Stepper …/>} />`.

### `Field` — sheet labels, lines 443–444, 457–458, 461–462, 473–480, 485–486, 499–500

`{ label, hint?, children, className? }`. Column gap 10: label 13/600 muted, children, optional hint 13 muted
(«Попереднє: 3 жовтня — 65,8 кг»). Controls inside (`TrainingToggle`, `ChipGroup`, `NumberStepperField`, `TextArea`)
automatically get `aria-labelledby` = the label and `aria-describedby` = the hint (`useFieldA11y` is exported for your
own controls).

### `NumberStepperField` — lines 463–467 (kcal), 475–479 (weight)

`{ value: string, onChange(text), unit, inputMode: 'numeric'|'decimal', decrementText, incrementText, onDecrement, onIncrement, size?: 'md'|'lg', decrementLabel?, incrementLabel?, ...input props (placeholder, name, id…) }`.
Grid `54px 1fr 54px`, gap 8. `md` (kcal): height 54, value 24/700, unit «ккал» 14 muted at right 14, input padding
`0 50px 0 12px`. `lg` (weight): height 64, display 30/700, unit 15 at right 16, padding `0 40px 0 12px`. Side buttons
`--r16`, 1px `--line`, `--card`, 15/600. Raw text in/out — parse with `num()`, sanitise kcal yourself
(`replace(/[^\d]/g, '')`). Kcal: `decrementText="−50" incrementText="+50" placeholder="0"`; weight: `«−0,1» / «+0,1»`, `placeholder="—"`.

### `TextArea` — lines 459, 501

`{ value, onChange(text), rows? = 3, ...textarea props }`. 16px / 1.45, `--card`, 1px `--line`, `--r16`, padding 14,
no resize; focus → `--acc` border. «Що я їла» `rows={3}`, «Нотатки» `rows={2}`.

### `TimeInput` — line 380

`{ value: 'HH:MM', onChange(hm), ...input props }`. `<input type="time">` 17/600, `--paper`, 1px `--line`, `--r12`,
padding `10px 12px`, min-height 44. Empty values (browser «clear») are ignored. Give it an `aria-label` («Час»).

### `MeasureInputTile` — lines 489–492

`{ label, value, onChange(text), placeholder? = '—', unit? = 'см', ...input props }`. The tile is a `<label>`:
`--card`, 1px `--line`, `--r16`, padding `10px 12px`, gap 6; label 13 muted; input 22/700 + unit 13 muted (baseline);
`inputMode="decimal"`. Placeholder = previous value (`fN(prev)`). Lay three out in `repeat(3, minmax(0,1fr))` gap 8.

### `QuickAction` — lines 92–95

`{ label, caption? = 'Додати', tone?: 'acc'|'acc2'|'neutral', onClick, className? }`. `--card`, 1px `--line`, `--r20`,
padding 14, gap 12, min-height 64; 36px `--r12` square with «+» (20/500) on `--acc2T` / `--accT` / `--line2`;
caption 12 muted, label 15/600. Grid: `1fr 1fr` mobile, `repeat(4, minmax(0,1fr))` desktop, gap 10, full width.

## Feedback

### `Pill` — lines 60, 180, 201

`{ children, tone?: 'acc'|'acc2'|'neutral'|'accSolid', size?: 'sm'|'md'|'lg', className? }`. Radius 999, nowrap.
`md` 12/600 `6px 10px` (status «Заповнено» = `acc2`, «Частково» = `acc`, «Порожньо» = `neutral`);
`sm` 12/600 `5px 9px` (history: type = `acc`, «Відпочинок» / «—» = `neutral`); `lg` 15/700 `8px 12px` with
`tone="accSolid"` (hero «−3,0 кг»).

### `Banner` — lines 44–51

`{ title, sub?, cta, onAction, full? = true, className? }`. `--accT`, `--r20`, padding `14px 14px 14px 16px`, gap 12;
10px `--acc` dot; title 15/600, sub 13 `--ink2`; CTA = `Button size="sm"`.

### `ProgressBar` — lines 63, 299, 341

`{ value (0–100, clamped), size?: 'sm' 6 | 'md' 8 | 'lg' 10, track?: 'line2'|'onSolid', tone?: 'acc'|'acc2', label?, className? }`.
Radius 99. Hero: `<ProgressBar value={pct} track="onSolid" />` (`--solidSub2` track). With `label` it is a
`role="progressbar"`, otherwise `aria-hidden`.

### `Legend` / `LegendItem` — lines 167–171, 331–335

`Legend { children, centered?, className? }`: 12px muted, wrap, gap 14; `centered` = calendar (centre + `padding-top: 4px`).
`LegendItem { color: 'acc'|'acc2'|'accT'|'acc2T'|'solid'|'line'|'faint', label, shape?: 'dot'|'square' }`: gap 6;
dot 8px circle (calendar), square 10px radius 3 (kcal). Plain text children (e.g. «· середнє за тиждень») are fine.

### `Toast` — lines 421–423

No props; rendered once by `AppShell`. Shows `useToast()` (`ui.flash(text)`): fixed `top: 18px + safe-top`, centred,
`--solid` / `--onSolid`, 600 14, padding `12px 18px`, radius 999, `--shadow-toast`; slides/fades in and out;
`role="status"` live region.

## Charts

### `LineChart` — lines 241–256 (weight), 269–281 (measurements)

`{ geometry, height?: 150 | 120, tone?: 'acc'|'acc2', showTag? = true, middleLabel?, 'aria-label'?, className? }`.
`geometry` = `{ viewBox?, line, area, dots: {leftPct, topPct, size}[], tag: {leftPct, topPct, text} | null, from, to }`
— `chartGeometry()` from `lib/stats` returns exactly this. SVG `0 0 320 120`, `preserveAspectRatio="none"`, gradient
area 0.28 → 0 (unique id per chart), 2.5px non-scaling round stroke; dots are HTML circles (size + 2px `--card` ring,
`size: 0` dots are not rendered); value tag = solid pill 12/700, radius 8, above the last dot. Footer 12px muted:
`from` · `middleLabel` · `to`, 6px under the plot.
Weight: `<LineChart geometry={g} aria-label="…" />`. Measurements: `height={120} tone="acc2" showTag={false} middleLabel="Талія, см"`.

### `BarChart` — lines 320–330

`{ bars: {heightPct, tone: 'empty'|'ok'|'over', label?}[], goalPct, gap? = '8px', labeled?, 'aria-label'?, className? }`.
Height 130, bars `flex: 1`, radius `6px 6px 3px 3px`, `empty` `--line`, `ok` `--acc2`, `over` `--acc`; dashed 1.5px
`--faint` goal line at `goalPct`% from the bottom; labels row (12 muted) 8px below when `labeled`.
From stats: `const k = kcalBars(…); <BarChart bars={k.bars} goalPct={k.goalPct} gap={k.gap} labeled={k.labeled} />`.

## Sheet — lines 425–510

```tsx
const sheet = useSheet();            // @/store/ui
const shown = useRetained(sheet);    // keeps the content during the exit animation
<Sheet
  open={sheet !== null}
  onClose={ui.closeSheet}
  heading="Запис дня"
  dateNav={{ date: dLongYear(d), weekday: '…', onPrev, onNext, canNext: d < today }}
  footer={<Button size="lg" fullWidth onClick={save}>Зберегти</Button>}
>
  {shown && <DayForm key={shown.key} … />}
</Sheet>
```

`SheetProps { open, onClose, heading, dateNav?, footer?, children?, onExited? }`;
`SheetDateNav { date, weekday, onPrev, onNext, canPrev?, canNext?, prevLabel? = 'Попередній день', nextLabel? = 'Наступний день' }`.

- Portal into `<body>`; backdrop `--backdrop` (z 60). Panel `--paper`, column, scrolls as a whole.
- Mobile: bottom-aligned, `max-width 440`, radius `--r28 --r28 0 0`, `max-height 92dvh`, slides up 280ms
  `--ease-out`. Desktop (`useIsDesktop()`): centred, `max-width 560`, radius `--r28`, `max-height min(720px, 92dvh)`.
- Sticky header (padding `10px 18px 0`, gap 12): 40×5 `--line3` handle; heading 14/500 muted (`<h2>`, the dialog's
  name) + 40px round `--line` «✕» («Закрити»); optional `dateNav` (card-surface `StepNav`, date display 22/700
  −0.02em, weekday 13 muted, padding-bottom 10). Without `dateNav` the header gets `padding-bottom: 10px`.
- Body: padding `4px 18px 18px`, column gap 18 — put `<Field>`s here.
- Sticky footer: padding `12px 18px calc(20px + safe-bottom)`, `--line` top border.
- Closes on Escape, backdrop click (press must start on the backdrop), «✕», and (phones) dragging the header down.
- Focus moves to the dialog on open, Tab is trapped inside, focus returns to the opener after closing.
- Locks page scroll iOS-safely (`html.scroll-locked` + fixed body at the current offset, restored afterwards).
- Stays mounted for `SHEET_EXIT_MS` (240ms) after `open` turns false, then calls `onExited`.

`useRetained(value)` returns `value`, or the last non-null value after it became `null`.

## App shell (`@/shell/AppShell`)

Not part of `@/ui`, listed for reference. Mobile: column `max-width 440`, padding `20px 18px 120px` (+ safe areas),
floating glass tab bar (Головна · Календар · «+» · Прогрес · Нагадування). Desktop ≥ 900px: container 1280, 248px
sticky sidebar (logo, links, «+ Записати день»), main padding `32px 36px 48px`. `<main>` is a flex column with gap 14;
screens render a `<ContentGrid>` inside it. «+» → `ui.openSheet(today, 'day')`. The page scrolls to the top on every
route change; tapping the current section scrolls to the top. Renders `<Toast />` and `<SheetHost />`.
