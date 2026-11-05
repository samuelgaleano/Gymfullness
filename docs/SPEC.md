# Gymfullness — Product & Engineering Spec

> Brief shared by every agent. Read it fully before writing code.
> The language of the product UI is **Spanish (neutral Latin-American, tuteo)**. Code, identifiers and comments are English.

## 1. Vision

A mobile-first web app (PWA) that is a **personal gym assistant**: the user opens it, taps one big button,
and the app tells them exactly what to do — exercise, set, reps, weight, rest — while they listen to music.
Logging must be so fast that it never feels like a chore: **one tap** ("✓ Serie hecha", prefilled) or
**hold-to-talk** like a WhatsApp voice note ("ochenta kilos, diez reps").

Principles (in priority order):
1. **Zero friction.** No mandatory signup. "Empezar sin cuenta" works instantly; Google login is optional and only
   offered when configured. A first-time user must be able to start a workout in ≤ 3 taps.
2. **Glanceable in the gym.** Huge numbers, high contrast, big touch targets (≥ 48 px, primary actions ≥ 56 px),
   one primary action per screen, thumb-reachable (primary actions in the bottom half).
3. **The app thinks, the user trains.** Prefill weights from last time + progression suggestion; auto-start rest;
   announce next exercise; remember everything.
4. **Respect music.** Never stop the user's music. Short beeps/vibration, optional voice announcements.
5. **Offline-first & free.** Everything works offline and with no backend. Cloud sync is an optional layer.
6. **Beautiful & calm.** Apple-like "liquid glass", minimal, professional. No clutter, no emoji soup.

## 2. Stack (fixed — do not add frameworks)

- Vite 8 + React 19 + TypeScript (strict). Path alias `@/` → `src/`.
- Routing: `wouter` (already wired in `src/App.tsx`). Navigate with `useLocation()` → `navigate('/path')`, or `<Link href>`.
- State: `zustand` store in `src/store/app.ts`, persisted to IndexedDB. **Read the store file before using it.**
  - ⚠️ zustand v5: never write a selector that returns a new array/object (`useApp(s => s.x.filter(...))`) — it
    causes an infinite render loop. Use the provided hooks `useRoutines()`, `useSessions()`, `useBodyLogs()` or
    `useShallow`, or select primitives / stable references and derive with `useMemo`.
- Icons: `lucide-react` only. Charts: hand-written SVG (no chart libraries).
- PWA: `vite-plugin-pwa` (configured). Hosting: Vercel (static + optional `api/*` serverless functions).
- Optional cloud: Firebase Auth (Google) + Firestore, **lazy-loaded** only when the user taps "Continuar con Google",
  enabled only when `VITE_FIREBASE_*` env vars exist.
- Tests: Vitest (`src/**/*.test.ts`, jsdom) and Playwright (`tests/e2e`, Chromium preinstalled — never run
  `playwright install`).
- New npm dependencies require a strong reason; prefer writing 50 lines over adding a package.

## 3. Data model

`src/lib/types.ts` is THE contract. Do not change existing shapes; you may add optional fields if truly needed
(mention it in your report). Key ideas:
- `WorkoutSession` with `exercises[].sets[]` pre-created from the routine targets (done=false) and prefilled.
- `cursor {ex, set}` = where the user is. `rest` = timestamp-based rest timer (`endsAt`), so it survives reloads and
  background throttling — always compute remaining time from `Date.now()`, never count ticks.
- Store `activeSession` (in progress) is persisted; completed sessions live in `sessions`.

## 4. Design system (MUST use)

- Tokens: `src/styles/tokens.css` (colors, radii, spacing, type, motion). Base/utilities: `src/styles/base.css`
  (`.glass`, `.screen`, `.stack`, `.row`, `.row-between`, `.muted`, `.faint`, `.section-title`, `.num`, `.truncate`).
- UI kit: `src/ui` (`Button`, `IconButton`, `Card`, `CardButton`, `Header`, `TopBar`, `Sheet`, `Stepper`,
  `ProgressRing`, `ProgressBar`, `toast`, `Segmented`, `Switch`, `Chip`, `ChipButton`, `EmptyState`, `Stat`,
  `Spinner`, `Field`, `List`, `ListRow`, `TabBar`). Read `src/ui/*.tsx` + `src/ui/ui.css` before building screens.
- Per-screen styles go in a co-located CSS file (e.g. `src/screens/workout/workout.css`) imported by the screen.
  Use tokens only (`var(--…)`), no raw hex colors. Prefix class names with the screen (`wk-`, `home-`, `rt-`, `pg-`,
  `pf-`, `wl-`, `sm-`, `ex-`) to avoid collisions.
- Visual language: dark-first glass cards over the fixed aurora background, volt accent (`--accent`) for the ONE
  primary action, cyan (`--rest`) for rest, gold (`--pr`) for personal records. Large-title headers. Generous spacing.
  Tabular numerals (`.num`) for anything that changes. Subtle motion (`--ease`, ≤ 360 ms), respect reduced motion.
- Layout: mobile first (360–430 px wide), max width 560 px centered on desktop. Tab screens use
  `<main className="screen">`; fullscreen flows (workout, welcome, summary) use `className="screen screen--full"`.
  Respect safe areas (`--safe-top`, `--safe-bottom`).
- Accessibility: every icon-only button has a label; color is never the only signal; contrast ≥ 4.5:1 for text;
  focus visible; `aria-live` for timer end and logged sets.
- Copy: short, warm, imperative Spanish. "Serie hecha", "Descanso", "Siguiente", "Terminar". Numbers with units.

## 5. Routes (wired in `src/App.tsx`)

| Route | Screen file | Notes |
|---|---|---|
| `/welcome` | `screens/welcome/WelcomeScreen.tsx` | first run: login / guest + optional 3-question plan setup |
| `/` | `screens/home/HomeScreen.tsx` | "Hoy": next routine, big Start, quick start, weekly ring, last session |
| `/routines` | `screens/routines/RoutinesScreen.tsx` | plan + routines + templates |
| `/routines/:id` | `screens/routines/RoutineEditorScreen.tsx` | `new` creates a routine |
| `/exercises` | `screens/exercises/ExerciseLibraryScreen.tsx` | search/filter library; `?pick=1` mode returns a choice |
| `/exercises/:id` | `screens/exercises/ExerciseDetailScreen.tsx` | technique, muscles, history, alternatives |
| `/workout` | `screens/workout/WorkoutScreen.tsx` | the live assistant (fullscreen) |
| `/summary/:id` | `screens/summary/SummaryScreen.tsx` | post-workout summary + download/share |
| `/history/:id` | same as summary | past session detail |
| `/progress` | `screens/progress/ProgressScreen.tsx` | overview, body, exercises, history |
| `/profile` | `screens/profile/ProfileScreen.tsx` | account, settings, data export/import |

Default export = the screen component. The tab bar shows on all non-fullscreen routes; leave
`calc(var(--tabbar-h) + safe-bottom)` space (the `.screen` class already does).

## 6. Core flows (acceptance criteria)

**A. First run, guest, start in ≤ 3 taps:** `/welcome` → "Empezar sin cuenta" → (optional plan questions, skippable)
→ Home → "Empezar entreno" → workout screen shows exercise 1, set 1, prefilled.

**B. Live workout (the heart):**
- Shows: exercise name, "Serie 2 de 4", target "8–12 reps", big weight + reps steppers prefilled, big primary
  "✓ Serie hecha" button, a hold-to-talk mic button, session elapsed time, overall progress bar, next-exercise preview.
- Logging a set (tap or voice) → toast "Serie 2 · 80 kg × 10" with **Deshacer** → rest timer auto-starts with the
  routine's rest seconds.
- Rest: large ring countdown (cyan), −15 s / +15 s, "Saltar", shows what's next ("Siguiente: Serie 3 · 80 kg × 10").
  At 3-2-1 short beeps (if enabled); at 0: beep + vibration + optional voice "Descanso terminado. Serie 3 de 4." +
  system notification if the page is hidden and permission was granted. Keep screen awake (Wake Lock) if enabled.
- Voice: press-and-hold mic (pointer down = start listening, up = stop & parse), live transcript bubble, parse
  → log set (or run command). If SpeechRecognition is unsupported, the mic opens a quick text box with the same
  parser ("80 10", "80x10", "igual"). Tap-to-toggle also works for accessibility.
- Rep counter: optional tap-anywhere big counter mode for counting reps during the set; time exercises get a
  countdown/stopwatch.
- Exercise actions: "Técnica" (sheet with setup/cues/mistakes/breathing + YouTube search link + ask-coach box),
  "Cambiar" (alternatives sheet), "Saltar", add/remove set, edit any logged set, add exercise, reorder.
- Finish: "Terminar" (confirm if sets remain) → `/summary/:id`.
- Reload/close the tab mid-workout → reopening resumes exactly where the user was (including rest).

**C. Summary:** duration, sets, reps, volume, PRs (gold), per-exercise sets; actions: "Descargar imagen" (PNG card
rendered with canvas), "Compartir" (Web Share API with the PNG, fallback download), "Descargar CSV", "Copiar texto".
Guest users see a soft, dismissible prompt to save progress with Google (only if configured).

**D. Progress:** weekly sessions/volume, streak, muscle-set balance (last 7 days), PR list, per-exercise trend
(e1RM line), body weight + measurements log with trend charts, history list → session detail.

**E. Profile/Settings:** sign in/out (Google if configured), units, default rest, auto-rest, sounds, vibration,
voice announcements, keep screen awake, voice language, theme, export JSON / import JSON, delete all data, about.

## 7. File ownership (parallel agents — edit ONLY your files)

Shared files owned by the orchestrator (read-only for agents unless told otherwise): `src/lib/types.ts`,
`src/store/app.ts`, `src/App.tsx`, `src/ui/*`, `src/styles/*`, `src/lib/{id,units,date}.ts`, configs.
If you truly need a change in a shared file, make the **smallest additive** change and list it in your report.

| Agent | Owns |
|---|---|
| data | `src/data/**`, `src/lib/planner.ts`, `src/lib/recommend.ts` (+ tests) |
| voice | `src/lib/voice/**`, `src/lib/audio.ts` (+ tests) |
| engine | `src/lib/workout/**`, `src/lib/stats.ts` (+ tests) |
| cloud | `src/lib/firebase.ts`, `src/lib/sync.ts`, `src/store/auth.ts`, `src/lib/coach.ts`, `api/**`, `firestore.rules`, `docs/SETUP.md`, `.env.example` (+ tests) |
| workout-ui | `src/screens/workout/**`, `src/screens/summary/**`, `src/lib/export.ts` |
| home-routines-ui | `src/screens/home/**`, `src/screens/routines/**`, `src/screens/exercises/**` |
| progress-ui | `src/screens/progress/**`, `src/ui/charts/**` |
| welcome-profile-ui | `src/screens/welcome/**`, `src/screens/profile/**` |

## 8. Verification each agent must do

- `npx tsc -b --noEmit` → zero errors **in your files** (others may be mid-edit; ignore theirs).
- `npx vitest run <your test files>` → green.
- UI agents: run `npx vite --port <your port> --strictPort` in the background, open the screen with Playwright
  (`require('playwright')`, `chromium.launch()`, viewport 390×844, `deviceScaleFactor: 1`), screenshot to the
  scratchpad and LOOK at it; fix what looks off. Seed data via the UI or by `page.evaluate` writing the store.
  Ports: workout-ui 5101, home-routines-ui 5102, progress-ui 5103, welcome-profile-ui 5104. Kill your server when done.
- Never commit; the orchestrator commits.
