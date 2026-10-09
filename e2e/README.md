# End-to-end tests

Playwright against the **real production bundle**: `apps/server/dist/index.js` serving `apps/web/dist`
on port 3399 with a fresh SQLite database (`%TEMP%/legko-e2e-*`) per run. Browsers are the system
Chrome (`channel: 'chrome'`, falls back to Edge; override with `E2E_CHANNEL=msedge`), nothing is
downloaded.

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
| `desktop` | 1280×800           | sidebar layout, centred modals                                          |

Both use `uk-UA`, `Europe/Kyiv`, reduced motion and block service workers (so `page.route` sees every
request); `offline.spec.ts` opts back in to the real service worker.

## Determinism

- **Clock**: every page gets `page.clock.install()` at **Wed 14 Oct 2026 10:00 Kyiv**
  (`support/env.ts`); time keeps running from there, so timers, backoff and toasts behave normally.
- **Data**: before each test the `server` fixture imports a known data set through `POST /api/import`
  (`test.use({ seed: 'demo' | 'empty' | 'onboarded' })`, default `demo` = the dev seed script's
  `demoData(TODAY)` from `apps/server/scripts/seed-demo.ts`). Each test has its own browser context,
  so IndexedDB / localStorage start empty. One worker, one server.
- **Login**: the browser context is logged in through the API (`test.use({ authed: false })` starts on the
  login screen). The password is the local test credential `DEV_PASSWORD` in `support/env.ts`.
- **AI**: the server runs without an Anthropic key; `support/food.ts` mocks `/api/food/status`,
  `/api/food/estimate` and `/api/photos/*` (photo = `fixtures/food.jpg`).
- No sleeps: web-first assertions and `expect.poll` (server state is checked through `GET /api/data`).

## Known app bugs

Tests that document a bug are `test.fixme` with a `FIXME(app bug …)` comment; remove the `.fixme` once
the app is fixed.

## Visual review pass

`visual.spec.ts` saves screenshots of every screen and sheet mode, light and dark, to
`e2e/__screenshots__/<project>/<light|dark>/` (git-ignored). They are for human review, not pixel
assertions. Long phone screens are saved as viewport-sized pages (`10-home-1.png`, `-2`, …) because the
tab bar is `position: fixed`.
