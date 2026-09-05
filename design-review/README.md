# Design-review captures

Screenshots of SMP Dashboard for an external design critique. Nothing in the
app was changed to produce them — this is the shipped UI, running against the
e2e harness's mocked Supabase origin so the screens are populated with
realistic rows instead of a live school's records.

14 files: the 7 requested screens × light and dark theme. Light keeps the
plain filename, dark adds a `-dark` suffix.

Regenerate with:

```bash
npx playwright test --config playwright.capture.config.js
```

(Its own config on purpose: the capture files don't match Playwright's default
`*.spec.js` pattern, so `npm run test:e2e` and CI never pick them up.)

## Screens

| File                           | Screen                                       | Viewport | PNG       |
| ------------------------------ | -------------------------------------------- | -------- | --------- |
| `01-login.png`                 | Login (demo mode, credentials prefilled)     | 1440×900 | 1440×900  |
| `02-admin-dashboard.png`       | Admin overview, populated                    | 1440×900 | 1440×900  |
| `03-admin-students-list.png`   | Students & Enrollment, 14-row table          | 1440×900 | 1440×1089 |
| `04-admin-modal-error.png`     | Add student modal, 4 inline field errors     | 1440×900 | 1440×900  |
| `05-teacher-gradebook.png`     | Teacher console → 7A Mathematics → Gradebook | 1440×900 | 1440×977  |
| `06-admin-dashboard-empty.png` | Admin overview, brand-new school (no data)   | 1440×900 | 1440×900  |
| `07-student-portal-mobile.png` | Student portal dashboard                     | 375×812  | 375×2012  |

Each has a `-dark` counterpart at the same dimensions. The theme is seeded
through the `smp-theme` localStorage key that every page's inline `<head>`
guard reads before first paint — the same path a returning user takes, so
there is no flash of the other theme in frame.

## Data

Every row on screen is a fixture served by a Playwright route handler inside
one browser context. Nothing is written to a database and nothing outlives the
run, so there is no seeded data to clean up afterwards (demo mode blocks writes
on top of that). `06` is the one screen left deliberately bare — it is a
request for the empty state itself.

## Capture settings

All full-page except `04`, which is viewport-sized: the modal overlay is
`position: fixed`, so a full-page shot stretches the canvas to the scroll
height of the table behind it and pushes the dialog out of frame. `1×` pixel
density throughout, no device frames, no annotations.
