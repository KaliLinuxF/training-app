# UI kit (`@/ui`)

Reusable pieces extracted from `design/handoff/Tracker.dc.html` (variant **1b «Свіжість»**). Every size, padding,
gap, font size/weight, letter-spacing, radius and colour below is copied from the prototype; colours and radii come
only from `styles/tokens.css`. Line numbers refer to `Tracker.dc.html`.

```tsx
import { Card, ListGroup, ListRow, Button, Sheet, useRetained, deltaTone } from '@/ui';
```

Redesign A «Чек-лист дня» (`docs/redesign-a.md`) builds screens from rows instead of tile grids: `ListGroup` /
`ListRow`, `Icon`, `StatStrip`, `ScreenHeader back`, compact `Banner`, `TrainingToggle size="sm"`. Components marked
**legacy** below are not used by redesign A and are scheduled for removal (kit prune after the redesign).

General rules

- Import from `@/ui` only (not from sub-folders).
- Every component accepts `className` (merged last). If you override a property the component sets, make sure your
  CSS module is imported after `@/ui` (it is when you import `@/ui` first) or raise specificity.
- Values are passed **formatted** (`f1`, `fN`, `f0`, `sgn`, `dLong`… from `@legko/shared`). Components never format.
- `Tone` = `'ink' | 'acc' | 'acc2' | 'muted' | 'faint'` → text colour `--ink`, `--accD`, `--acc2D`, `--muted`, `--faint`.
  `deltaTone(n)` ports the prototype `tone()`: `< −0.04` → `acc2` (mint), `> 0.04` → `acc` (lavender), else `ink`.
- `cx(...classes)` joins class names (falsy values skipped).
- Focus: the global `:focus-visible` ring is `2px solid var(--focus)` (light `--accD`, dark `--acc`: ≥ 3:1 on paper, card,
  line and accT). Text fields show it as their border plus a 1px spread (`box-shadow: 0 0 0 1px var(--focus)`).
  `hero` / `solid` cards set `--focus: var(--focusOnSolid)` for controls on the dark surface. Never `outline: none` without
  a replacement ring.
- Tap targets ≥ 44px (SPEC §2). A smaller visual size keeps its look and grows the hit area with a transparent
  `::after { position: absolute; inset: … }` on a `position: relative` host (`Button sm`, `Segmented`, sheet ✕, ghost button).
- Grid children are one column wide; use `full` (where offered), `<FullRow>` or `className={fullRowClass}` to span
  both desktop columns (`grid-column: 1 / -1`).

---

## Layout

### `ScreenHeader` — lines 35–41, 140–145, 211–214, 352–355

`{ title, subtitle?, right?, back?, focusTitle?, className? }`. Subtitle 14 muted above an `<h1>` title (display
30/700, −0.025em, line-height 1.1); column gap 4; row `space-between`, `align-items: flex-end`, padding `8px 4px 4px`;
always full width. Home: `<ScreenHeader subtitle="Субота, 10 жовтня" title={greeting()} right={<Avatar />} />`.

- `back?: { href, label }` — sub-page back link above the subtitle/title row (the header becomes a column, gap 2):
  `Icon chevronLeft` 20 + label, 15/600 `--accD`, inline-flex gap 2, min-height 44, padding `0 10px 0 4px`,
  margin-left −8 (the chevron lines up with the title), `--r12`, `:active` → `--accT`. Accessible name
  `Назад: ${label}`. A click runs `useBackTo(href)` (see Navigation): `history.back()` when the page was opened from
  `href`, else a replace navigation to `href`. The hook lives in a private `BackLink` component, never in the handler.
- `focusTitle?` — on mount the `<h1>` gets `tabIndex={-1}` and `focus({ preventScroll: true })`, so VoiceOver and
  the keyboard start on the new page's title. Settings sub-pages:
  `<ScreenHeader back={{ href: '/settings', label: 'Налаштування' }} focusTitle={cameFrom(history.state, '/settings')} title="Нагадування" />`.

### `ContentGrid` — lines 34, 139, 210, 351 (`cols` in `renderVals`)

`<div>` props. 1 column on phones, `repeat(2, minmax(0,1fr))` in the desktop shell — the media query is `DESKTOP_QUERY`
(`(min-width: 900px) and (hover: hover) and (pointer: fine)`, same as `useIsDesktop`), so a phone in landscape stays
one column. Gap 14, `align-items: start`. Also exports `FullRow` (div spanning all columns) and `fullRowClass`.

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

### `SectionTitle` / `Section` — lines 99–100, 191–192 (`Section` is legacy: not used by redesign A, scheduled for removal; `SectionTitle` stays — it is the desktop Settings pane `<h2>` in `screens/settings/SettingsSectionPage.tsx`)

`SectionTitle { children, id?, as?, className? }`: display 18/700, −0.01em, padding `6px 4px 0`. Redesign A uses it
as the `aria-labelledby` `<h2>` of the desktop Settings detail pane.
`Section { title, children, gap?: 8 | 10 (default 10), full?, className? }`: `<section>` column = title + content.
«Цей тиждень» → `<Section title="Цей тиждень">`, «Останні записи» → `<Section title="Останні записи" gap={8} full>`.

## Tiles & rows

### `Tile` — lines 67–68, 78–79, 118–122, 235–238, 288–291, 314–317 (legacy: not used by redesign A, scheduled for removal)

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

### `StatTile` — lines 103–106 (legacy: not used by redesign A, scheduled for removal; use `StatStrip`)

`{ label, value, unit?, tone? = 'ink', className? }`. `--card`, border `--line`, `--r20`, padding `14px 16px`, gap 4;
label 13 muted; value 24/700 (−0.02em) in `tone`; unit 14/500 muted after a space. Home «Цей тиждень».

### `KeyValueRow` — lines 129–132, 224–227, 388–395

`{ label, value, variant?, tone?, className? }`

- `control` (default): label 14 muted, value 15/600 right-aligned, padding `13px 0`, `--line2` divider below,
  none after the last row. Put them in `<Card variant="list">`. (legacy: not used by redesign A, scheduled for removal)
- `summary`: label 15 `--ink2`, value 16/700 in `tone`, padding `8px 0`, `--accLine` divider above each row. In
  `<Card variant="tint">`. (legacy: not used by redesign A, scheduled for removal)
- `plain`: label 15 `--ink2`, `value` rendered as-is (e.g. `<Stepper …/>`), no divider. «Мої цілі».

### `DetailRow` — lines 183–186 (legacy: not used by redesign A, scheduled for removal)

`{ label, value, className? }`. Grid `104px minmax(0,1fr)`, gap 12, padding `11px 0`, `--line2` divider above;
label 14 muted; value 15/500, line-height 1.4, wraps. `null` / `''` / `'—'` render a `--faint` «—».

### `BarRow` — lines 297–301, 339–343

`{ label, value, pct, variant?: 'rank'|'history', tone?: 'acc'|'acc2' (default 'acc'), onClick?, 'aria-label'?, className? }`

- `rank`: grid `92px / 1fr / 28px`, gap 10; label 14/500; 10px bar (`--line2` track); value 14/700. «Найчастіше».
- `history`: grid `96px / 1fr / 78px`, gap 10, padding `9px 0`, min-height 44 (tap target), `--line2` divider above; label 14; 6px bar; value
  14/600. «Історія калорій»: `tone={item.tone === 'over' ? 'acc' : 'acc2'}`, `onClick` → open that day.

### `StatStrip` — redesign A (Progress «Тренування», «Харчування»)

`{ items: { label, value, unit?, tone? }[], columns?: 2|3|4, desktopColumns?: 2|3|4, 'aria-label'?, className? }`.
Big unboxed numbers instead of a tile grid. `columns` defaults to `min(items.length, 4)`, `desktopColumns` to
`columns` (inside the literal `DESKTOP_QUERY` media query).

- `<dl>` grid, `repeat(n, minmax(0,1fr))`, column-gap 12, row-gap 14, margin 0. Each cell is a `<div>` with `<dt>`
  label then `<dd>` value (+ `<span>` unit), so the text reads «Тренувань 2» (`textContent` «Тренувань2»); the cell is
  `flex-direction: column-reverse` (gap 2), which draws the value on top.
- Value 22/700, −0.02em, line-height 1.15, nowrap, coloured by `tone` (`toneClass`); a value of «—» is always `--faint`.
  Label 13/500 lh 1.3 `--ink2` (wraps; ≥ 4.5:1 on `--card` and `--accT`). Unit 13/600 `--ink2`, margin-left 3.
- The Progress period summary is **not** a strip (it is one sentence line).

```tsx
<StatStrip
  aria-label="Тренування"
  items={[
    { label: 'Всього', value: '41' },
    { label: 'Цього тижня', value: '2' },
    { label: 'Цього місяця', value: '7' },
    { label: 'В сер. / тиж.', value: '4' },
  ]}
/>
```

## Lists, icons & navigation (redesign A)

### `Icon` — `ui/icons/Icon.tsx`, `ui/icons/paths.ts`

`{ name: IconName, size?: 16 | 20 | 22 | 24 (default 24), className? }`. Line icons on a 24×24 grid, content inside
3–21 (unit-tested on every path's end points), `fill="none" stroke="currentColor" strokeWidth={1.8}`, round caps and
joins, `aria-hidden="true" focusable="false"` — always decorative: name the control around it.
`IconName` = `home calendar chart gear` (tab bar / sidebar) · `food workout weight measure notes` (actions, day rows) ·
`bell target theme data logout` (settings rows) · `chevronRight chevronLeft`. `ICON_PATHS[name]` is the list of path
strings (`home`, `calendar`, `chart`, `bell` are the former `shell/NavIcon` glyphs; `gear` is the ISC-licensed lucide
cog scaled into the 3–21 box; its licence notice heads `icons/paths.ts` as a `/*! @license */` comment — keep it).
No emoji in rows.

### `ListGroup` — `ui/lists/ListGroup.tsx`

`{ children (ListRow only), title?, titleSize?: 'md'|'lg', titleId?, subtitle?, headerRight?, footer?, caption?, note?, 'aria-label'?, 'aria-labelledby'?, full?, flush?, className? }`

```
 caption              <h2> 14/600 --muted, padding 0 16px          (optional, above the card)
 ┌ card ─────────────────────────────────────────┐  --card, 1px --line, --r24, overflow clip
 │ title (h2)                       headerRight  │  header only with `title`: padding 12px 16px 2px, gap 12
 │ subtitle                                      │  title md 18/700 −0.01em · lg 20/700 −0.015em; subtitle 14 --muted
 │ <ul role="list">  ListRow · ListRow · …       │  padding 4px 0 (`flush` → 0)
 │ footer                                        │  padding 4px 16px 16px
 └───────────────────────────────────────────────┘
 note                 13 --muted, line-height 1.4, padding 0 16px  (optional, below the card)
```

- Root column, gap 8 (caption / card / note); `full` → `grid-column: 1 / -1`; `className` on the root.
- Name: with `title` the root is `<section aria-labelledby={title id}>` (named by the title only, never by the
  subtitle; `titleId` sets the id); with only `caption` it is named by the caption; with only `aria-label` /
  `aria-labelledby` it is a `<section>` with those; otherwise a plain `<div>`.
- `flush` is for single-row groups (the Home week row: 2 + 60 = 62px).

### `ListRow` — `ui/lists/ListRow.tsx`

`{ title, titleTone?: 'ink'|'accent', sub?, subTone?, subWrap?, icon?, iconTone?: 'acc'|'acc2'|'neutral', value?, valueVariant?: 'strong'|'soft', valueTone?, meter?: { value, tone: 'acc'|'acc2' }, chevron?, trailing?, children?, size?: 'md'|'lg', 'aria-label'?, 'aria-describedby'?, describeSub?, className? }`
plus exactly one of: `{ href, replace?, current? }` (wouter `<Link>`) · `{ onClick, disabled?, 'aria-haspopup'?: 'dialog' }`
(`<button type="button">`) · neither (static `<div>`). Render it inside a `ListGroup`.

Anatomy — `<li>` → action element → `<div class=trailing>` (a **sibling** of the action, never inside it) →
`<div class=extra>{children}</div>` (under the row, outside the action, e.g. a `PhotoStrip`). Inside the action, in
DOM order: icon square (`aria-hidden`), title, sub, meter (decorative `ProgressBar sm`, `aria-hidden`), value, chevron
(`Icon chevronRight` 16 in `--faint`, `aria-hidden`). The accessible name is the visible title, sub and value (spaces
between them) unless `aria-label` is given.

```
 ┌──────┬──────────────────────────────┬──────────────┬───┐
 │ icon │ title                        │        value │ › │   grid: auto · minmax(0,1fr) · fit-content(60%) · auto
 │      │ sub (2 lines)                               │   │   areas 'icon title value chev' / 'icon sub sub chev'
 │      │ ███████░░░░ meter                           │   │         / 'icon meter meter chev' (only rows that exist)
 └──────┴─────────────────────────────────────────────┴───┘
```

- **Spacing without empty-column gaps**: `column-gap: 0` — CSS grid keeps a gap next to an empty `auto` track, so the
  spacing is a margin on each part that exists: icon `margin-right: 14px`, value `margin-left: 12px`, chevron
  `margin-left: 8px`. A row without an icon starts its title at the 16px padding. Row-gap 2, centred vertically —
  except the icon of a `subWrap` row (class `top`, `align-self: start`), which stays beside the title when the sub
  runs several lines (calendar «Їжа»); its value and chevron stay centred. The
  value track is `fit-content(60%)`: at most 60% of the row, right-aligned, wraps, tabular numbers. (A `max-width: 60%`
  on the value would resolve against its own `auto` track and wrap it needlessly.)
- **md** (default): min-height 60, padding `10px 16px`; icon 40×40 `--r12`, 22px glyph; title 16/600 lh 1.3 `--ink`.
- **lg** («Що записати?» menu): min-height 72, padding `12px 16px`; icon 48×48 `--r14`, 24px glyph; title 17/600.
- Text: `titleTone="accent"` → `--accD` («Вийти»). Sub 14/500 lh 1.35 `--ink2`, clamped to 2 lines; `subWrap` → no
  clamp, `white-space: pre-line`, `overflow-wrap: anywhere` (calendar food text / notes); `subTone` recolours it.
  Value `strong` 15/700 `--ink` (default) · `soft` 15/500 `--ink2` (settings summaries); `valueTone` recolours it; a
  `<Pill>` is fine as a value. Meter: 6px, margin-top 6.
- Icon tones: `acc` → `--accT` square / `--accD` glyph · `acc2` → `--acc2T` / `--acc2D` · `neutral` (default) →
  `--line2` / `--ink2`.
- Chevron: shown by default for `href` / `onClick`, hidden for a static row; `chevron` overrides.
- Divider: `.item + .item::before`, 1px `--line2`, from `--inset` to the right edge — 70px (md with icon), 78px (lg
  with icon), 16px without an icon — i.e. where the title starts.
- `trailing` (e.g. `TrainingToggle size="sm"`, `Switch`): the `<li>` becomes a grid `minmax(0,1fr) auto`; the action
  keeps padding-right 8 and `.trailing` has padding-right 16 (flex, centred, gap 8). Pressing the toggle never fires
  the row's `onClick`.
- `.extra`: padding `0 16px 12px <inset>`, `position: relative` (thumbnail buttons stay tappable).
- **≤ 359px** (`@media (max-width: 359px)`, 320px Display Zoom): action padding-left 12; md icon 36×36 with a 20px
  glyph and margin-right 12; `.trailing` padding-right 12; divider inset 60 (md with icon). At 320 the Home training
  row keeps a ~108px title column next to the toggle.
- States: `:active` → `--line2` (background transition 120ms, killed by the global reduced-motion rule);
  `@media (hover: hover) and (pointer: fine)` `:hover` → `--paper`; **`aria-current` (`current`) → `--accT`
  background and an `--accD` title** (the sidebar's active pattern; `--line2` on `--card` is ≈1.1:1, invisible);
  `:focus-visible` → `outline: 2px solid var(--focus); outline-offset: -3px; border-radius: var(--r20)` (inset, so the
  group's overflow clip never cuts it); `disabled` → opacity .45, no press.
- `aria-label` replaces the name on the link / button. `describeSub` (with a short `aria-label`) gives the sub an id
  from a top-level `useId()` and adds it to the action's `aria-describedby` (after any given `aria-describedby`), so the
  food text / notes stay audible. A static row with `aria-label` reads the label from visually hidden text (ARIA
  forbids `aria-label` on a plain `<div>`) and hides the visible copy from screen readers.
- `href` rows stamp `history.state` with `{ legkoFrom: <current path> }` (see Navigation); `current` sets
  `aria-current="page"`, `replace` replaces the history entry.

### Recipes

Home «Сьогодні» — title + ghost button, training row with an inline toggle:

```tsx
<ListGroup
  title="Сьогодні"
  headerRight={
    <Button variant="ghost" onClick={openDay}>
      Відкрити день →
    </Button>
  }
>
  <ListRow
    icon="food"
    iconTone="acc2"
    title="Їжа"
    value="1 240 / 1 700 ккал"
    meter={{ value: 73, tone: 'acc2' }}
    aria-label="Їжа: 1 240 з 1 700 ккал"
    onClick={() => ui.openSheet(today, 'food')}
    aria-haspopup="dialog"
  />
  <ListRow
    icon="workout"
    iconTone="acc"
    title="Тренування"
    sub="За планом о 18:00"
    subTone="acc"
    chevron={false}
    onClick={() => ui.openSheet(today, 'workout')}
    aria-haspopup="dialog"
    trailing={
      <TrainingToggle
        size="sm"
        value={entry?.trained ?? null}
        aria-label="Тренування сьогодні"
        onChange={(v) => setTrainedMark(today, v)}
      />
    }
  />
  <ListRow
    icon="weight"
    title="Вага"
    sub="12 жовтня — 65,4 кг"
    value={
      <Pill tone="acc" size="sm">
        Сьогодні
      </Pill>
    }
    onClick={() => ui.openSheet(today, 'weight')}
    aria-haspopup="dialog"
  />
  <ListRow
    icon="measure"
    title="Заміри"
    sub="Груди 90 · Талія 70 · Стегна 98"
    value="Пн, 19 жовтня"
    valueVariant="soft"
    onClick={() => ui.openSheet(today, 'measure')}
    aria-haspopup="dialog"
  />
</ListGroup>
```

(`setTrainedMark` comes from `@/store/dayMarks`, not from `@/ui`: it saves and toasts «Відмічено: тренування було» /
«Відмічено: без тренування», and does nothing when the day is already marked that way.)

The «Що записати?» menu — four `lg` rows in a group without a title (the dialog heading names it):

```tsx
<ListGroup aria-label="Що записати?">
  <ListRow
    size="lg"
    icon="food"
    iconTone="acc2"
    title="Їжа"
    sub="Опис або фото"
    value="1 240 ккал"
    onClick={() => ui.openSheet(date, 'food')}
  />
  {/* Тренування · Вага · Заміри */}
</ListGroup>
```

A settings group — `href` rows with soft values, a `Pill` in the sub, and «Вийти» on its own:

```tsx
<nav aria-label="Розділи налаштувань">
  <ListGroup>
    <ListRow href="/settings/reminders" icon="bell" iconTone="acc" title="Нагадування" value="3 увімк."
      valueVariant="soft" sub={<Pill tone="acc" size="sm">Сповіщення вимкнені</Pill>} current={section === 'reminders'} />
    <ListRow href="/settings/goals" icon="target" title="Цілі" value="60 кг · 1 700 ккал" valueVariant="soft" />
  </ListGroup>
</nav>
<ListGroup>
  <ListRow icon="logout" title="Вийти" titleTone="accent" chevron={false} onClick={logout} />
</ListGroup>
```

The calendar day card — large title, subtitle, status pill, footer, wrapped text with photos, described rows:

```tsx
<ListGroup title="14 жовтня 2026" titleSize="lg" subtitle="середа · сьогодні"
  headerRight={<Pill tone="acc">Частково</Pill>}
  footer={<Button variant="outline" fullWidth onClick={() => ui.openSheet(date, 'day')}>Редагувати день</Button>}>
  <ListRow icon="food" iconTone="acc2" title="Їжа" sub={day.food} subWrap value="1 880 ккал"
    aria-label="Їжа: 1 880 ккал" describeSub onClick={() => ui.openSheet(date, 'food')}>
    <PhotoStrip … />
  </ListRow>
  <ListRow icon="workout" iconTone="acc" title="Тренування" sub="Низ тіла, Прес" chevron={false}
    onClick={() => ui.openSheet(date, 'workout')}
    trailing={<TrainingToggle size="sm" value={day.trained} onChange={(v) => setTrainedMark(date, v)} />} />
  <ListRow icon="notes" title="Нотатки" sub={day.notes} subWrap aria-label="Нотатки" describeSub
    onClick={() => ui.openSheet(date, 'day')} />
</ListGroup>
```

The Home week row — one link row in a `flush` group:

```tsx
<ListGroup flush>
  <ListRow
    href="/progress?period=week"
    title="Тиждень"
    value="2 з 3 трен. · сер. 1 795 ккал"
    aria-label="Тиждень: 2 з 3 тренувань, середня калорійність 1 795 ккал. Відкрити прогрес"
  />
</ListGroup>
```

### Navigation — `ui/internal/backNav.ts`

`BACK_STATE_KEY = 'legkoFrom'`, `backState(from)` → `{ legkoFrom: from }`, `cameFrom(state, parent)` (true only for an
object whose `legkoFrom === parent`), `useBackTo(parent)` → `(e?) => void`.

- A `ListRow href` stamps `history.state.legkoFrom` with the page it was opened from (wouter `Link state`).
- `useBackTo(parent)` (a hook: call it at the top level of a component) returns a click handler that calls
  `e?.preventDefault()`, then `history.back()` when `cameFrom(history.state, parent)` — the history does not grow;
  the shell still scrolls to the top on the route change — else `navigate(parent, { replace: true })` (deep link,
  reload, push URL).
  `ScreenHeader back` and the active «Налаштування» tab on a sub-route use it.
- Use flat absolute routes (`/settings`, `/settings/:section`), no wouter `nest` — `backState` stores the absolute path.

## Controls

### `Button` — lines 28, 50, 75, 188, 361, 506

`{ variant?, size?, fullWidth?, ...button props }` (`type="button"` by default; `:active` scale .98; disabled = opacity .45)

- variants: `solid` (default; `--solid`/`--onSolid`), `accent` (`--acc`/`--onAcc`, 700, nowrap), `outline` (`--card` +
  1px `--line`, ink), `ghost` (transparent, muted 14/500, padding `8px 0`; ignores `size`). The ghost box is 35px tall;
  its `::after { inset: -5px -6px }` grows the tap area to 45px (it was 43 with −4px) — «Відкрити день →»,
  «Повний запис дня →» and «+ Нотатка до дня» rely on it, no local overrides needed.
- sizes: `sm` 14/600, padding `10px 14px`, `--r12`, min-height 40 (44 for `accent`), tap area grown invisibly to 44 —
  banner CTA, notifications CTA;
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

`{ value: boolean | null, onChange(trained: boolean), size?: 'sm'|'md'|'lg', 'aria-label'?, 'aria-labelledby'?, className? }`.
Grid `1fr 1fr` gap 10; buttons 600, border 1.5px. `md` (Home): 15px, `--r14`, min-height 50. `lg` (sheet): 16px,
`--r16`, min-height 54. «✓ Було» selected → `--accT` + `--acc` border; «✕ Не було» selected → `--solid` bg,
`--onSolid` text, `--ink` border; unselected → `--card` + `--line`. `aria-pressed` on both; `onChange` fires on every
press (also on the already pressed option — callers decide what a repeat means). Group name: Field label, else «Тренування».

`sm` (redesign A, `trailing` of a `ListRow`: Home «Тренування», calendar day): grid `44px 44px`, gap 6; each option
44×44, `--r14`, 1.5px border, padding 0, `:active` scale .96. Content = glyph «✓» / «✕» 18/700 `aria-hidden` +
visually hidden «Було» / «Не було», so the buttons keep those accessible names. Pressed ✓ draws the glyph in `--accD`
on `--accT`; pressed ✕ as above. Give the group an `aria-label` («Тренування сьогодні»).

### `Chip` / `ChipGroup` — lines 450–453

`Chip { selected, children, ...button props }`: pill, 1.5px border, 600 14, padding `0 16px`, min-height 44;
selected → `--accT` / `--accD` / `--acc` border, else `--card` / ink / `--line`. `aria-pressed`.
`ChipGroup { children, 'aria-label'?, 'aria-labelledby'?, className? }`: wrapping row, gap 8 (`role="group"`, labelled by the Field).

### `Segmented` — lines 215–218

`{ options: {value, label}[], value, onChange, 'aria-label' (required), sticky?, full?, className? }` (generic over the value).
Track `--line`, padding 4, `--r16`, equal columns, gap 4. Items min-height 40 (tap area 44), `--r12`, 13/600; active →
`--card`, ink, `--shadow-seg`; else transparent / `--ink2` (`--muted` is below 4.5:1 on the track). `role="radiogroup"` + `role="radio"`, roving tabindex, ←/→/Home/End.
`sticky` → `position: sticky; top: calc(8px + safe-top); z-index: 5`. Progress: `<Segmented full sticky aria-label="Період" …/>`.

### `Switch` — line 371

`{ checked, onChange(next), 'aria-label'? | 'aria-labelledby'?, 'aria-describedby'?, disabled?, id?, className? }`.
52×32 pill, padding 3; on `--acc2`, off `--line3`; knob 26 `--knob` with `--shadow-knob`, slides 20px.
`role="switch"` + `aria-checked`; tap area extended to 44px.

### `WeekdayPicker` — lines 373–376

Discriminated by `mode`:

- `{ mode: 'multi', value: Weekday[], onChange(days: Weekday[]) }` — toggle buttons (`aria-pressed`); result sorted Monday-first.
- `{ mode: 'single', value: Weekday, onChange(day: Weekday) }` — radio group with arrow keys.
  Common: `'aria-label'` (required), `disabled?`, `className?`. Grid of 7 (gap 5; each tap area reaches into half of the gaps,
  so ≥ 44px wide from 375px), Monday first, labels «Пн…Нд»
  (accessible names «Понеділок…»). Buttons min-height 44, `--r12`, 13/600, 1.5px border; selected → `--solid` /
  `--onSolid` / `--ink` border, else `--card` / ink / `--line`. For the «off» state the prototype dims the picker and the
  time row with `opacity: .45` — do that in the screen. Also exports `toggleWeekday(days, day)`.

### `Stepper` — lines 390–394

`{ value (formatted), onDecrement, onIncrement, decrementLabel? = 'Зменшити', incrementLabel? = 'Збільшити', canDecrement?, canIncrement?, 'aria-label'?, className? }`.
`IconButton shape="step"` (paper) − value (display 17/700, min-width 96, `<output aria-live>`) +; gap 6.
Below 360px (320px phones) the value is 16/700, min-width 80, gap 4, so «Мої цілі» rows fit the card; 360px+ unchanged.
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
no resize; focus → 2px `--focus` ring (border + 1px spread). «Що я їла» `rows={3}`, «Нотатки» `rows={2}`.

### `TimeInput` — line 380

`{ value: 'HH:MM', onChange(hm), ...input props }`. `<input type="time">` 17/600, `--paper`, 1px `--line`, `--r12`,
padding `10px 12px`, min-height 44, focus → 2px `--focus` ring. Empty values (browser «clear») are ignored. Give it an `aria-label` («Час»).

### `MeasureInputTile` — lines 489–492

`{ label, value, onChange(text), placeholder? = '—', unit? = 'см', ...input props }`. The tile is a `<label>`:
`--card`, 1px `--line`, `--r16`, padding `10px 12px`, gap 6; label 13 muted; input 22/700 + unit 13 muted (baseline);
`inputMode="decimal"`, focus → 2px `--focus` ring on the tile. Placeholder = previous value (`fN(prev)`); a placeholder with a
digit is drawn in `--muted` (it is data, ≥ 4.5:1), the plain «—» stays `--faint`. Lay three out in `repeat(3, minmax(0,1fr))` gap 8.

### `QuickAction` — lines 92–95 (legacy: not used by redesign A, scheduled for removal)

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

`{ title, sub?, size?: 'md'|'compact', cta?, onAction?, onDismiss?, dismissLabel? = 'Сховати', full? = true, className? }`
(`cta` and `onAction` come together or not at all). `md` (default): `--accT`, `--r20`, padding `14px 14px 14px 16px`,
gap 12; 10px `--acc` dot; title 15/600, sub 13 `--ink2`; CTA = `Button size="sm"`.

- `size="compact"` (redesign A Home: setup «Почнімо» / iPhone install hint — at most one): min-height 56, padding
  `8px 8px 8px 14px`, gap 10, `--r16`, 8px dot; title 14/600 clamped to **2 lines**, sub 13 lh 1.35 `--ink2` clamped
  to **3 lines** (never an ellipsis mid-sentence: at 390px the text column beside «Налаштувати» is ~185px and the
  setup sub needs 3 lines, ≈90px tall). Below 360px (Display Zoom, ~120px column) the sub is not clamped at all.
- `onDismiss` adds a ✕ button named `dismissLabel` (any size): 32×32, transparent, glyph 13/600 `--ink2`
  (`aria-hidden`), `::after { inset: -6px }` → 44px tap area, `:active` scale .94. Replaces `screens/home/DismissibleBanner`.
- Without `cta` there is no button besides the optional ✕.

### `ProgressBar` — lines 63, 299, 341

`{ value (0–100, clamped), size?: 'sm' 6 | 'md' 8 | 'lg' 10, track?: 'line2'|'onSolid', tone?: 'acc'|'acc2', label?, className? }`.
Radius 99. Hero: `<ProgressBar value={pct} track="onSolid" />` (`--solidSub2` track). With `label` it is a
`role="progressbar"`, otherwise `aria-hidden`. It renders `display: block` spans (phrasing content), so it may sit
inside a `<button>` — the `ListRow` meter.

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

`SheetProps { open, onClose, heading, dateNav?, footer?, children?, onExited?, size? }`;
`SheetDateNav { date, weekday, onPrev, onNext, canPrev?, canNext?, prevLabel? = 'Попередній день', nextLabel? = 'Наступний день' }`;
`size: 'default' | 'compact'` (default `'default'`).

- Portal into `<body>`; backdrop `--backdrop` (z 60), padded by `--safe-left` / `--safe-right` (landscape iPhone). Panel
  `--paper`, column, scrolls as a whole.
- Mobile: bottom-aligned, `max-width 440`, radius `--r28 --r28 0 0`, `max-height 92dvh`, slides up 280ms
  `--ease-out`. Desktop (`useIsDesktop()`): centred, `max-width 560`, radius `--r28`, `max-height min(720px, 92dvh)`.
- `size="compact"` — a small window (one food position): phones `max-height 86dvh`; desktop `max-width 440` (as tall
  as any desktop sheet: `max-height min(720px, 92dvh)`). Everything else (header, body, footer) is the same.
- Sticky header (padding `10px 18px 0`, gap 12): 40×5 `--line3` handle; heading 14/500 muted (`<h2>`, the dialog's
  name) + 40px round `--line` «✕» («Закрити», 44px tap area); optional `dateNav` (card-surface `StepNav`, date display 22/700
  −0.02em, weekday 13 muted, padding-bottom 10). Without `dateNav` the header gets `padding-bottom: 10px`.
- Body: padding `4px 18px 18px`, column gap 18 — put `<Field>`s here.
- Sticky footer: padding `12px 18px calc(20px + safe-bottom)`, `--line` top border.
- Closes on Escape, backdrop click (press must start on the backdrop), «✕», and (phones) dragging the header down.
- Focus moves to the dialog on open — unless the content already took it (`autoFocus`, or focused inside the tap so
  the iPhone keyboard opens), then it stays there. Tab is trapped inside, focus returns to the opener after closing.
- Locks page scroll iOS-safely (`html.scroll-locked` + fixed body at the current offset, restored afterwards).
- Stays mounted for `SHEET_EXIT_MS` (240ms) after `open` turns false, then calls `onExited`. Meanwhile its backdrop
  stays an invisible shield over everything under it (only the panel stops taking presses), so the second tap of a
  double tap on «Зберегти» / «Готово» lands on nothing — not on the page, not on the sheet below. A press on the shield
  doesn't close anything or move focus.

`useRetained(value)` returns `value`, or the last non-null value after it became `null`.

### Stacked sheets (a second window over a sheet)

No extra props: render another `<Sheet>` — usually inside the first sheet's content — and open it. The AI estimate's
item editor over «Запис дня»:

```tsx
const shownItem = useRetained(editing);        // keeps the editor filled while it slides out
<Sheet open={editing !== null} onClose={closeEditor} heading="Позиція" size="compact" footer={…}>
  {shownItem && <ItemFields key={shownItem.key} … />}
</Sheet>
```

- Drawn above the sheet under it: `z-index` 60 + 2 per level (capped at 68 — below the photo viewer 70, the toast 80
  and `ui.confirm()` 90), later in `<body>`. Its backdrop is two coats of `--backdrop` (over the sheet below ≈ 0.66 light,
  0.80 dark), so that sheet and its solid «Зберегти» recede. Phones: slides up from the bottom with `max-height 86dvh`,
  so the sheet underneath peeks out above it; the bottom-aligned footers coincide («Готово» over «Зберегти»). Desktop:
  centred modal exactly as tall as a desktop sheet may be (`min-height` = `max-height` = `min(720px, 92dvh)`), so its
  footer covers the footer of the sheet below instead of sitting right above it, whatever its content (a compact one is
  narrower: only the ends of the footer below show at its sides, under the double dim).
- Only the top sheet reacts to Escape, backdrop presses and drag-down. Every sheet under it is `inert` (no focus, no
  taps, hidden from VoiceOver) until the top one starts closing — during its exit animation the sheet below is live again
  (focus goes back there), while taps still land on the top sheet's backdrop until it has gone (see above).
- One shared, ref-counted scroll lock: the page stays locked until the last sheet is gone, then the scroll position is
  restored once.
- Focus moves into the top sheet and Tab is trapped there. As soon as it starts closing, focus goes back to the element
  that opened it in the sheet below (the row, «+ позиція»), or to that sheet's panel when the opener is gone (the row was
  deleted). It is not pulled back again when the top sheet unmounts, and not taken from `ui.confirm()` while it is open.
  To land somewhere else (the row just added), focus it in a `useEffect` of the commit that closes the top sheet, or
  after `flushSync`: the sheet below stops being inert in that commit's layout phase, and focus the top sheet no
  longer holds is left alone. (Not straight in the click handler before the close has rendered: inert then.)
- A sheet rendered inside another sheet's content stacks above it even when both mount in the same render; sibling
  sheets stack in the order they open. Logic: `sheet/stack.ts`.
- React events from the inner sheet still bubble to its React parents (portals do that): don't wrap the inner `<Sheet>`
  in elements with click / key handlers.

## App shell (`@/shell/AppShell`)

Not part of `@/ui`, listed for reference. Mobile: column `max-width 440`, padding
`calc(12px + var(--safe-top)) 18px calc(120px + var(--safe-bottom))`, floating glass tab bar
(Головна · Календар · «+» · Прогрес · Налаштування, `Icon` glyphs `home calendar chart gear`) centred between the side
safe areas; «+» → `ui.openSheet(today, 'menu')` (the «Що записати?» menu). Tapping the active «Налаштування» tab on a
sub-route goes back to the list with `useBackTo('/settings')`.
Desktop (`DESKTOP_QUERY`: ≥ 900px **and** a mouse/trackpad, so a phone in landscape keeps the mobile shell): container
1280, 248px sticky sidebar (logo, links, «+ Записати день»), main padding `32px 36px 48px`. `#root` is padded by
`--safe-left` / `--safe-right` (notched iPhone in landscape). `<main>` is a flex column with gap 14;
screens render a `<ContentGrid>` inside it. The sidebar's «+ Записати день» opens the same `'menu'` sheet (centred
modal). The page scrolls to the top on every route change; tapping the current section scrolls to the top. Renders
`<Toast />` and `<SheetHost />`.
