# End-to-end tests

Playwright against the **real production bundle**: `apps/server/dist/index.js` serving `apps/web/dist`
on port 3399 with a fresh SQLite database (`%TEMP%/legko-e2e-*`) per run. Browsers are the system
Chrome (`channel: 'chrome'`, falls back to Edge; override with `E2E_CHANNEL=msedge`), nothing is
downloaded. One run at a time: the port and the database are shared.

```sh
pnpm e2e                         # pnpm -r build, then the whole suite (both projects)
pnpm e2e:run                     # suite only, against the existing build
pnpm e2e:run --project=iphone    # one project
pnpm e2e:run e2e/food.spec.ts    # one file
pnpm e2e:visual                  # screenshot pass only
pnpm e2e:report                  # open the last HTML report (playwright-report/)
pnpm e2e:typecheck               # tsc over e2e/ and playwright.config.ts
```

## Projects

| project   | viewport           | notes                                                                   |
| --------- | ------------------ | ----------------------------------------------------------------------- |
| `iphone`  | 390×844 @3x, touch | Chromium with the iPhone 14 Safari user agent (install hint, iOS paths) |
| `desktop` | 1280×800           | sidebar layout, centred modals, Settings list + detail                  |

Both use `uk-UA`, `Europe/Kyiv`, reduced motion and block service workers (so `page.route` sees every
request); `offline.spec.ts` opts back in to the real service worker. Tests that measure the installed
app (status bar + home indicator) set the viewport to 390×763 themselves.

## Determinism

- **Clock**: every page gets `page.clock.install()` at **Wed 14 Oct 2026 10:00 Kyiv**
  (`support/env.ts`); time keeps running from there, so timers, backoff and toasts behave normally.
  Wednesday is a planned workout day in the default reminders, so Home's «Тренування» row reads
  «За планом о 18:00» until it is marked. At 10:00 a new meal starts as «Сніданок» (`suggestMealType`).
- **Data**: before each test the `server` fixture imports a known data set through `POST /api/import`
  (`test.use({ seed: 'demo' | 'empty' | 'onboarded' | 'meals' })`, `fixtures/data.ts`):
  - `demo` (default) = the dev seed script's `demoData(TODAY)` from `apps/server/scripts/seed-demo.ts`. Today is a
    **legacy** day (food text «Вівсянка з бананом, кава», no kcal, no workout mark), so Home's «Їжа» row reads
    «Записано» + «Калорії не вказані» and the «Їжа» list shows one block «Їжа за день». Today−6 … today−1 are **meal
    days** (3–4 typed meals with Б · Ж · В, same day kcal as before — e.g. 13 Oct: Сніданок / Обід / Вечеря, 1 740 ккал,
    Б 114 · Ж 62 · В 181); older days are legacy days. «Часті страви» have macros except «Яблуко».
  - `meals` = demo + today as two meals (`MEALS_TODAY`): Сніданок 08:15 with two positions (380 ккал, Б 12 · Ж 9 ·
    В 63) and Перекус 09:40 «Яблуко» 80 ккал without macros — the day is 460 ккал and _partial_ (the apple has energy
    but no macros) — plus macro goals `MEALS_GOALS` = Білки 90 · Жири 60 · Вуглеводи none. A new meal at 10:00 is
    «Перекус» (breakfast is logged).
  - `empty` = a brand-new account (the setup sheet opens by itself); `onboarded` = nothing recorded, setup done.

  Each test has its own browser context, so IndexedDB / localStorage start empty. One worker, one server.

- **Login**: the browser context is logged in through the API (`test.use({ authed: false })` starts on the
  login screen). The password is the local test credential `DEV_PASSWORD` in `support/env.ts`.
- **AI**: the server runs without an Anthropic key; `support/food.ts` mocks `/api/food/status`,
  `/api/food/estimate` and `/api/photos/*` (photo = `fixtures/food.jpg`). `TEXT_ESTIMATE` / `PHOTO_ESTIMATE` carry
  Б · Ж · В (Борщ 300 г 180 ккал 6 · 9 · 19; Хліб житній 2 скибки 140 ккал 4,5 · 1 · 28; Сирники зі сметаною 3 шт
  420 ккал 22 · 22 · 33); `recalcAnswer(items)` builds a «✨ Перерахувати» answer. Without `mockFood` the AI is off
  (no AI row in the meal editor).
- No sleeps: web-first assertions and `expect.poll` (server state is checked through `GET /api/data`;
  `server.sendOps(ops)` posts raw ops, e.g. the exact shapes an old client sends).

## Helpers (`support/app.ts`)

Written against roles and visible copy (redesign A «Чек-лист дня», `docs/redesign-a.md` §3.5, and the meals release,
`docs/meals-macros.md` §6.4):

- `go('Головна' | 'Календар' | 'Прогрес' | 'Налаштування')` — tab bar / sidebar link, waits for the `<h1>`.
- `record('Їжа' | 'Тренування' | 'Вага' | 'Заміри' | 'Повний запис дня')` — «+» → «Що записати?» → the row;
  returns the sheet the menu swapped to. `record('Їжа')` (= `newMeal()`) returns **«Прийом їжі»**, a new meal for
  today (type preselected, «Що я їла» focused).
- Meals: `openFoodDay()` (Home «Їжа» → the day's list «Їжа»; needs food today — on an empty day the row opens
  «Прийом їжі» instead), `mealList(sheet)` (region «Прийоми їжі», in «Їжа» **and** in the «Запис дня» food field),
  `mealRow(sheet, title)` (row button whose name starts with the title: «Сніданок о 08:15: …», «Їжа за день»),
  `addMealButton(sheet)` («+ Прийом їжі», name «Додати прийом їжі»), `mealType(sheet, label)` (chip in group «Тип
  прийому їжі», selected = `aria-pressed="true"`), `saveMeal(sheet)` («Зберегти» of a meal editor, stacked or not:
  waits for it to close and for «Збережено»).
- `homeRow(name)`, `trainingToggle('Було' | 'Не було')`, `weekLink()` — Home «Сьогодні» rows, the inline ✓ / ✕
  and the week row.
- `settingsRow(title)`, `openSettings(title)` (in-app navigation), `gotoSettings(title)` (page load of
  `/settings/<slug>`; «Прийоми їжі» = `meals`), `settingsBack()` (phone only — gate those tests to the `iphone`
  project).
- `sheet(name)` by dialog name: «Що записати?», «Їжа» (the day's meals), «Прийом їжі» (meal editor, new or existing),
  «Позиція» / «Нова позиція» (item editor), «Тренування», «Запис дня», «Контрольне зважування», «Заміри тіла»,
  «Перші кроки», «Встановлення на iPhone». Stacked sheets are separate dialogs: «Їжа» → «Прийом їжі» → «Позиція»
  (z-index 60 / 62 / 64; the ones below are `inert`).
- The deprecated shims (`quickAction`, `go` / `heading('Нагадування')`, `sheet('Налаштування')`) only keep old
  code typechecking; their behaviour changed. Do not use them in new tests.

Offline (`context.setOffline(true)`) with the service worker blocked: a page load fails, so offline steps
navigate inside the app (`openSettings`, `go`) instead of `gotoSettings` / `goto`.

Playwright treats `aria-disabled="true"` as disabled for `click()`: the app's locked buttons (AI row, ↑ / ↓ at the
ends, «+ Прийом їжі» at 20 meals) are pressed with focus + Enter, or checked by attribute.

## Specs

| spec                                                                                         | what                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meals.spec.ts`                                                                              | «+» → «Прийом їжі» (type by the time, keyboard), saving, the legacy block becoming a typed meal, «+ Свій», ‹ › moving a draft, the list «Їжа» (totals, rows), stacked sheets, delete, the «Запис дня» food field |
| `food.spec.ts`                                                                               | AI estimate in the meal editor (mocked): positions with Б · Ж · В, undo, photo, item editor rescale / typed kcal / recalculation, «Часті страви», hints                                                          |
| `compat.spec.ts`                                                                             | API level (no browser): old-shape `day.put` / `day.delete` on meal days (Rule L), a `day.put` with a `meals` key, `settings.put` without the new fields, an old backup, export ↔ import of the new fields        |
| `home.spec.ts`, `calendar.spec.ts`, `progress.spec.ts`, `settings.spec.ts`, `backup.spec.ts` | the screens, incl. the macro sub, meal lines, the Б · Ж · В averages, «Прийоми їжі» and the macro goals                                                                                                          |
| `capture.spec.ts`, `day-record.spec.ts`, `deep-links.spec.ts`, `weight-measure.spec.ts`      | the «+» menu, the day sheets (they save only `day.meta` / weigh-in / measurements), deep links                                                                                                                   |
| `a11y.spec.ts`                                                                               | 44px targets, 16px inputs, no nested controls, dialog names and the inert stack, WCAG 2.5.3 label-in-name, the «68 з 90 г» reading                                                                               |
| `gestures.spec.ts`                                                                           | swipes and drag-down (a stacked «Прийом їжі» / «Позиція» closes alone, asking when dirty)                                                                                                                        |
| `sync.spec.ts`, `offline.spec.ts`, `auth.spec.ts`, `onboarding.spec.ts`, `shell.spec.ts`     | two devices (a meal, a partial ✓), offline meal + workout, session, first run, tab bar                                                                                                                           |
| `visual.spec.ts`                                                                             | the screenshot pass below                                                                                                                                                                                        |

## Known app bugs

Tests that document a bug are `test.fixme` with a `FIXME(app bug …)` comment; remove the `.fixme` once
the app is fixed. None open (the last one, «Прибрати ці позиції» contains its visible label, is fixed: the
button is named «Прибрати ці позиції — останній підрахунок»).

## Visual review pass

`visual.spec.ts` saves screenshots of every screen and sheet mode, light and dark, to
`e2e/__screenshots__/<project>/<light|dark>/` (git-ignored). They are for human review, not pixel
assertions. Long phone screens are saved as viewport-sized pages (`30-progress-week-1.png`, `-2`, …) because
the tab bar is `position: fixed`; a phone screen that fits the viewport is saved as one file (Home is one
page now: `10-home.png`). Desktop `fullPage` shots are one image. A sheet taller than its panel also gets
`<name>-bottom.png` (scrolled to its end). `*-320.png` are the narrowest phone (320×640, `iphone` only).

| shots                | what                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01`–`02`            | login, wrong password                                                                                                                                                                                                                                                                                                                                                                                   |
| `10`–`13`            | Home: demo, offline (after an inline ✕), due day (weigh / measure / planned workout, 1 820 kcal over the goal), goal reached (≥ 4.5:1 in dark too)                                                                                                                                                                                                                                                      |
| `14`–`15`            | Home with Б · Ж · В (seed `meals`): without goals «Б 12 · Ж 9 · В 63 г · 2 прийоми»; with goals, kcal and protein over (lavender `--accD`, checked) (+ `15-…-320`)                                                                                                                                                                                                                                      |
| `20`–`23`            | Calendar: month + today, a tapped day, a day with food photos, `23-calendar-day-meals` (13 Oct: one line per meal + the day's Б · Ж · В) (+ `-320`)                                                                                                                                                                                                                                                     |
| `30`–`34`            | Progress: week, all time, the sticky period bar, «Показати ще» history, `34-progress-macros` (the «Б · Ж · В — середнє за день» strip with goals) (+ `-320`)                                                                                                                                                                                                                                            |
| `40`–`48`            | Settings: the list, offline «Дані і копія», each sub-page (`/settings/reminders` … `/data`), `47-settings-meal-types` (view, `-edit` mode, `-edit-320`), `48-settings-goals-macros` (Б · Ж · В goals with the «Від 1 до 1 000 г» error); on desktop list + detail                                                                                                                                       |
| `50`–`59`            | «Що записати?», then the meal editor the menu swaps to: `51-sheet-meal` (new, AI row above the text), `52-…-composer` («✨ Додати ще»), `53-…-estimate` (positions), `54-…-photo-estimate`, `55-…-photos`, `56-photo-viewer`, `57-…-frequent-edit` (+ `57-sheet-meal-bottom`), `58-…-kcal-error` (a meal by hand), `59` Home after the save toast                                                       |
| `531`–`537`          | positions of a meal and the item editor «Позиція» (a photo estimate with three rows; `532-editor-row-bottom` on the phone)                                                                                                                                                                                                                                                                              |
| `60`–`61`, `70`–`71` | weigh-in and measurements, with an error                                                                                                                                                                                                                                                                                                                                                                |
| `62`–`68`            | `62-food-day-list` (seed `meals`: totals + rows), `63-food-day-legacy` (the demo's «Їжа за день» block), `64-meal-new` (a new meal on a day with meals: Перекус, «За день», «Усі прийоми за день →»), `65-meal-positions` (stacked over the list), `66-meal-manual` (folded «+ Б · Ж · В», `-open`), `67-item-editor-macros` (+ `-manual`), `68-meal-stacked-depth2` («Їжа» → «Прийом їжі» → «Позиція») |
| `75`–`77`            | «Тренування» (empty; ✓ + Кардіо + own type + notes open), the full «Запис дня» of 13 Oct (its meal rows, + `-bottom`)                                                                                                                                                                                                                                                                                   |
| `80`                 | install guide (phone)                                                                                                                                                                                                                                                                                                                                                                                   |
| `90`–`94`            | first-run «Перші кроки» (+ error), empty Home / Calendar / Progress                                                                                                                                                                                                                                                                                                                                     |

When you clean up stale pages, delete only files the current `visual.spec.ts` no longer writes.

## Test-only fixes from the meals gate (e2e-visual)

Changes to specs owned by other packages during the final gate, never app code and never a weaker intent:

- `e2e/settings.spec.ts:553` and `:716` (package settings) — the tests «her list: add, rename, move, delete and
  restore…» and «macro goals … set on Enter and on blur…» called `app.openSettings()` (in-app navigation through the
  tab bar) on a blank page, so they timed out waiting for the navigation; added `await app.goto('/')` first, as the
  other in-app-navigation tests do. Nothing they assert changed.

Own specs rewritten for the meals release (not fixes of other packages' work): `a11y.spec.ts`, `gestures.spec.ts`,
`offline.spec.ts` (the day sheet has no kcal field any more), `sync.spec.ts` (the ✕ now sends `day.meta`, not
`day.put`), `visual.spec.ts`.
