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
  «За планом о 18:00» until it is marked.
- **Data**: before each test the `server` fixture imports a known data set through `POST /api/import`
  (`test.use({ seed: 'demo' | 'empty' | 'onboarded' })`, default `demo` = the dev seed script's
  `demoData(TODAY)` from `apps/server/scripts/seed-demo.ts`; today has food text only, no kcal and no
  workout mark, so Home's «Їжа» row reads «Записано» + «Калорії не вказані»). Each test has its own
  browser context, so IndexedDB / localStorage start empty. One worker, one server.
- **Login**: the browser context is logged in through the API (`test.use({ authed: false })` starts on the
  login screen). The password is the local test credential `DEV_PASSWORD` in `support/env.ts`.
- **AI**: the server runs without an Anthropic key; `support/food.ts` mocks `/api/food/status`,
  `/api/food/estimate` and `/api/photos/*` (photo = `fixtures/food.jpg`).
- No sleeps: web-first assertions and `expect.poll` (server state is checked through `GET /api/data`).

## Helpers (`support/app.ts`)

Written against roles and visible copy (redesign A «Чек-лист дня», `docs/redesign-a.md` §3.5):

- `go('Головна' | 'Календар' | 'Прогрес' | 'Налаштування')` — tab bar / sidebar link, waits for the `<h1>`.
- `record('Їжа' | 'Тренування' | 'Вага' | 'Заміри' | 'Повний запис дня')` — «+» → «Що записати?» → the row;
  returns the sheet the menu swapped to.
- `homeRow(name)`, `trainingToggle('Було' | 'Не було')`, `weekLink()` — Home «Сьогодні» rows, the inline ✓ / ✕
  and the week row.
- `settingsRow(title)`, `openSettings(title)` (in-app navigation), `gotoSettings(title)` (page load of
  `/settings/<slug>`), `settingsBack()` (phone only — gate those tests to the `iphone` project).
- `sheet(name)` by dialog name: «Що записати?», «Їжа», «Тренування», «Запис дня», «Контрольне зважування»,
  «Заміри тіла», «Перші кроки», «Встановлення на iPhone».
- The deprecated shims (`quickAction`, `go` / `heading('Нагадування')`, `sheet('Налаштування')`) only keep old
  code typechecking; their behaviour changed. Do not use them in new tests.

Offline (`context.setOffline(true)`) with the service worker blocked: a page load fails, so offline steps
navigate inside the app (`openSettings`, `go`) instead of `gotoSettings` / `goto`.

## Known app bugs

Tests that document a bug are `test.fixme` with a `FIXME(app bug …)` comment; remove the `.fixme` once
the app is fixed.

## Visual review pass

`visual.spec.ts` saves screenshots of every screen and sheet mode, light and dark, to
`e2e/__screenshots__/<project>/<light|dark>/` (git-ignored). They are for human review, not pixel
assertions. Long phone screens are saved as viewport-sized pages (`30-progress-week-1.png`, `-2`, …) because
the tab bar is `position: fixed`; a phone screen that fits the viewport is saved as one file (Home is one
page now: `10-home.png`). Desktop `fullPage` shots are one image.

| shots                | what                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01`–`02`            | login, wrong password                                                                                                                                                     |
| `10`–`13`            | Home: demo, offline (after an inline ✕), due day (weigh / measure / planned workout, 1 820 kcal over the goal), goal reached (checked ≥ 4.5:1 in dark too)                |
| `20`–`22`            | Calendar: month + today, a tapped day scrolled into view, a day with food photos                                                                                          |
| `30`–`33`            | Progress: week, all time, scrolled with the sticky period bar, «Показати ще» history                                                                                      |
| `40`–`46`            | Settings: the list, offline «Дані і копія», then each sub-page (`/settings/reminders` … `/data`); on desktop list + detail with the selected row                          |
| `50`–`59`            | «Що записати?», the short «Їжа» sheet and its food flows (composer, estimate, photo estimate, photos, viewer, «Часті страви» edit, kcal error), Home after the save toast |
| `531`–`537`          | the food workflow's estimate list and item editor (+ `532-editor-row-bottom` on the phone)                                                                                |
| `60`–`61`, `70`–`71` | weigh-in and measurements, with an error                                                                                                                                  |
| `75`–`77`            | «Тренування» (empty; ✓ + Кардіо + own type + notes open), the full «Запис дня» from the calendar                                                                          |
| `80`                 | install guide (phone)                                                                                                                                                     |
| `90`–`94`            | first-run «Перші кроки» (+ error), empty Home / Calendar / Progress                                                                                                       |

The `53x-*` shots (`531-estimate-list` … `537-estimate-list-after`, `532-editor-row-bottom`) are written by the
food workflow's «estimate list and item editor» test and are its review artefacts: keep them (and any other `53-*`
file) when you clean up stale pages. Delete only pages the current `visual.spec.ts` no longer writes.

`e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/gestures.spec.ts` and `e2e/food.spec.ts` carry tests of the food
workflow (estimate list, item editor, its drag-down); while that workflow has uncommitted edits in them
(`git status --porcelain <file>` not empty), other work leaves those files alone.
