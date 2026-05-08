# DevWorld 2026 — Personalized Schedule Recommender

Static web app that takes the full DevWorld 2026 agenda, lets you describe your
professional context, and asks an LLM (via [OpenRouter](https://openrouter.ai))
to pick the best session per time slot — plus alternatives — with a brief
rationale for each.

Templating is driven by [spektrum](https://www.npmjs.com/package/spektrum) —
all bindings (`data-each`, `data-if`, `:class`, `data-model`, `data-action`)
live declaratively in [`index.html`](./index.html); [`app.js`](./app.js) only
loads data, derives state via `computed`, and registers `defineFn` handlers.
Rendering is handled by spektrum's reactive engine — there is no manual DOM
mutation.

No build step. ESM + import map. Runs anywhere static files run, including
GitHub Pages.

## Run locally

```sh
cd path/to/devworld26
python3 -m http.server 8080
# open http://localhost:8080
```

You need `data/sessions.json` and `vendor/spektrum.js` present — both are
checked in. Re-generate the agenda from the source markdown if it changes:

```sh
python3 scripts/parse_sessions.py
cp .claude/references/all-sessions.json data/sessions.json
```

If you want to bump the spektrum version:

```sh
npm install spektrum@latest
cp node_modules/spektrum/spektrum.js vendor/spektrum.js
cp node_modules/spektrum/spektrum.d.ts vendor/spektrum.d.ts
```

## Deploy to GitHub Pages

1. Push this folder to a public (or Pages-enabled private) GitHub repo.
2. Repo settings → **Pages** → **Source**: Deploy from a branch → **main** /
   root (`/`).
3. Wait ~30s for the deploy. The site will be at
   `https://<your-username>.github.io/<repo-name>/`.

The included `.nojekyll` file disables Jekyll so files starting with `_` (none
right now, but a guard) are served as-is. `node_modules/` is gitignored —
spektrum is vendored under [`vendor/`](./vendor/) so deploys don't depend on
npm at build time.

## Configuring the API key

The app reads the OpenRouter API key in this order:

1. `?api=...` (or `?key=...`) on the URL — see "URL-based key" below.
2. Whatever the user typed into **Settings → OpenRouter API key** (stored in
   `localStorage`, per-browser).
3. `window.APP_CONFIG.OPENROUTER_API_KEY` from [`config.js`](./config.js).

### URL-based key

Visit the site with the key in the query string:

```text
https://d-dezeeuw.github.io/my-confs/?api=sk-or-v1-xxxxxxxx
```

On boot the app:

1. Reads the `api` (or `key`) param.
2. Writes it into `localStorage` so subsequent reloads work without the
   param.
3. **Immediately strips the param from the URL via `history.replaceState`**
   — so the key doesn't end up in browser history, bookmarks, or any
   `Referer` headers when the user clicks an outbound link.

Useful when you've configured the app on your laptop and want to bring it
up on your phone without manually typing the key, or for a personal
bookmark that one-shots the setup.

> **Caveats**: query strings still travel through HTTPS encrypted, but the
> URL appears in: the address bar at the moment of first visit, your local
> browser history (if your browser caches before strip), screenshots, and
> any chat/email where you paste the link. Treat the URL like a credential
> and rotate the key if you share it more broadly than intended.

`config.js` ships with a default key for convenience.

> **Security warning**: anything in `config.js` is a public file once
> deployed. If you push this site publicly with the key embedded, the key is
> exposed to anyone who views the page.
>
> Two safe options:
>
> - **Empty the key in `config.js` before publishing** and have each user
>   paste their own key into Settings (it stays in their browser's
>   localStorage).
> - **Keep the repo private** and only share the GitHub Pages URL with people
>   you trust — but note the page itself is still publicly fetchable if
>   Pages is enabled, even on a private repo, unless you use a Pro/Enterprise
>   private-Pages tier.
>
> To rotate the key after exposure: revoke it in your OpenRouter dashboard
> and generate a new one.

## Picking a model

Settings has a model dropdown. Defaults to `anthropic/claude-sonnet-4.5`.
Cheaper / faster: `anthropic/claude-haiku-4.5`, `google/gemini-2.5-flash`,
`openai/gpt-4o-mini`. More capable / pricier: `anthropic/claude-opus-4.5`.

Any OpenRouter model slug that supports
`response_format: { type: "json_object" }` will work — paste a different model
into the `<select>` source if you want one not listed.

## How it works

1. **Load** — [`app.js`](./app.js) fetches `data/sessions.json` and enriches
   each session with end-time and a `metaText` summary.
2. **Derive state** — `computed("slots", [...])` groups sessions by start
   time, applies tag/stage filters, and merges in the latest recommendations
   so each session card carries a `recKind` ("pick" | "alt" | "") and a
   matching rationale. A second `computed("agendaItems", ...)` collects only
   the picks, sorted chronologically, for the personal-agenda view.
3. **Render** — spektrum's `data-each` clones HTML templates per slot, per
   session, per tag pill. Reactivity wires up automatically: clicking a chip
   writes to state via a `defineFn` handler, the `slots` computed re-runs,
   and the affected cards toggle their `hidden` / `pick` / `alt` classes via
   `:class` bindings on the next tick.
4. **Recommend** — clicking the button POSTs your context + the (slightly
   trimmed) agenda to OpenRouter's chat-completions endpoint, asking for a
   strict-JSON response with one pick + alternatives per slot. The result
   lands on `state.rawRecs` and the `slots` computed pulls it into each
   card's recommendation badge / rationale.

## Personal agenda view + URL routing

After recommendations land, a floating button appears (full-width pill on
mobile, bottom-right on desktop) labelled **Your agenda · N**. Tapping it
opens a compact chronological view of just the picks, each with the LLM's
rationale.

Routing is hash-based:

- `#schedule` (or no hash) — full grid view
- `#agenda` — compact picks-only view

`state.view` derives from `window.location.hash` on load, and a
`hashchange` listener keeps state in sync when the user uses the browser
back button.

Recommendations + the strategy paragraph + your context are persisted in
`localStorage` (`dw26.rawRecs`, `dw26.overallAdvice`, `dw26.context`).
Revisit the page with `#agenda` and you land directly on your saved picks.

A **Save PDF** button in the agenda header runs `window.print()` against a
print stylesheet that hides app chrome, switches to white background and
black text, force-opens the strategy block, and applies
`page-break-inside: avoid` per pick. Pick "Save as PDF" in the browser's
print dialog. Real searchable text — no rasterisation.

## Notifications (5-min heads-up)

A banner in the agenda view offers an **Enable** button. After granting
browser permission you'll get a desktop / OS-level notification 5 minutes
before each recommended session starts. The notification includes the time,
title, stage, and speaker(s) with their company.

How it works:

- An in-page `setInterval` polls every 30 seconds against the agenda picks.
- For each pick, the scheduler computes `today.startTime - 5 min`. If the
  current time is in the 60-second window leading up to that, it fires a
  `new Notification(...)` and remembers the pick id in `localStorage`
  (`dw26.notifiedIds`) so reloads don't re-fire.
- Picks already past their fire-time are silently marked as notified-or-stale
  — you never receive a "5 min before" alert for a session that already
  started.
- Generating a new set of recommendations resets the notified list.

> **Caveats:**
>
> - The tab must remain open in some browser window. Static GitHub Pages
>   sites can't push from a server, so there is no way to notify with the
>   page closed.
> - Background tabs are throttled by browsers (typically to once per minute),
>   which is fine for the 30-second poll. The `visibilitychange` listener
>   triggers an immediate catch-up poll when you switch back to the tab.
> - **iOS Safari**: Notifications API works while the tab is foreground.
>   For background notifications you'd need to install the site to your
>   home screen as a PWA — out of scope for this static demo.
> - Times in `sessions.json` are HH:MM only; the scheduler uses **today's
>   date** as the date component. If you open the app on a non-conference
>   day, notifications fire at "today's" replicated times.

A **Test** button (visible after Enable) sends a one-shot notification so
you can confirm permission works without waiting for an actual pick.

## Mobile-first

Base styles target small viewports (single-column layout, full-width
controls, 16px font on inputs to dodge iOS zoom-on-focus, safe-area padding
above the FAB). Desktop columns + sticky sidebar kick in at
`@media (min-width: 900px)`.

## Files

- [`index.html`](./index.html) — markup + spektrum templates (data-each,
  data-if, :class, data-model, data-action).
- [`style.css`](./style.css) — dark theme, CSS Grid layout.
- [`app.js`](./app.js) — load, derived state, action handlers.
- [`config.js`](./config.js) — default API key + model.
- [`data/sessions.json`](./data/sessions.json) — the conference agenda
  (55 sessions).
- [`scripts/parse_sessions.py`](./scripts/parse_sessions.py) — converts the
  source markdown to JSON.
- [`.claude/references/all-sessions.md`](./.claude/references/all-sessions.md)
  — original raw agenda export.
- [`vendor/spektrum.js`](./vendor/spektrum.js) — vendored spektrum runtime.
- [`.nojekyll`](./.nojekyll) — disables Jekyll on GitHub Pages.

## A note on spektrum varName collisions

spektrum's `data-each` rewrites whole-word occurrences of the `data-as`
identifier inside the cloned subtree — including attribute values. That means
you have to pick `data-as` names that don't appear as whole words in any
class name or attribute inside the loop. The templates here use
`bucket` (slots), `ses` (sessions), `pill` (tag chips), `filterTag`, and
`filterStage` precisely because none of those collide with the `slot-*` /
`session-*` / `chip` class names. If you rename a class or add a varName,
sanity-check it against [the rewrite scope rules](https://www.npmjs.com/package/spektrum)
in spektrum's README.
