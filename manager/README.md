# Time Capture — Announcement Feed Manager

A small **local, owner-only** tool for authoring and publishing the Time Capture
announcement feed (`feed.json` at the root of this repo). It replaces
hand-editing the JSON: compose entries to the exact schema the desktop app
parses, preview how each will render, and publish (write `feed.json` +
commit + push — GitHub Pages then serves the update to every install within
a few minutes).

> This tool is **not** part of the distributed desktop app and is **not** on
> the `time-capture` repo's `main` / `testing` / `planning` workflow. It lives
> here, next to the feed it manages, because the feed is public and there are
> **no secrets** involved. It has its own tests and CI.

---

## What it does

| Slice | Detail |
|-------|--------|
| **Feed editor** | Loads the **live published feed from `origin/main`** (fetched on open, so you edit what installs actually see), lists entries, and lets you **create / edit / delete / reorder** them. A form per entry covers every field (id, category, severity, audience, version range, links, dates) with live validation. A **↻ Refresh from main** button re-fetches on demand (with an unsaved-changes guard); a header badge shows **`live`** (fetch confirmed), **`cached (offline)`** (couldn't reach origin — possibly stale), or **`local file`**. |
| **Preview** | Shows how the selected entry will behave in the app: `security` → **blocking modal** (all tiers); `ad` → **daily pop** (Lite ad-supported) with an Upgrade button; `general` → **inbox** item. Title/body render as **plain text** — no HTML injection, mirroring the app's safe render. Also shows which tiers the entry is visible to (severity/audience rules) and the version range. |
| **Publish** | **Publish → open PR** builds a `feed/update-<timestamp>` branch **off the latest `origin/main`** and opens a pull request into `main` (via the `gh` CLI if available, otherwise it returns a ready "open PR" link). Publishing **hard-fails if it can't `git fetch` the base** — it never builds a PR off a possibly-stale cached ref (which could silently revert newer entries once merged). It uses git plumbing containing **only** the `feed.json` change, so it **never touches your working tree or current branch**, can't pick up unrelated local commits, and nothing lands on `main` outside the `feed-check` gate. **Save feed.json** just writes the file to disk (for a manual commit). |
| **Merge** | After a PR is opened (with `gh`), a **✓ Merge PR** button appears. It runs `gh pr merge --auto --squash --delete-branch`, which asks GitHub to merge **once `feed-check` passes** — it does **not** bypass the ruleset, so a feed that fails validation still can't be merged. Requires the `gh` CLI (authenticated) and **"Allow auto-merge"** enabled in the repo settings (Settings → General → Pull Requests). After it merges, click **↻ Refresh from main** to load the now-live feed. |

The emitted JSON is deterministic (canonical key order, 2-space indent,
trailing newline) so a bad publish is a one-line `git revert`.

---

## Run it

Requires [Node.js](https://nodejs.org/) 20+ (works on 22) and `git` on your PATH.

**Easiest — double-click launcher** (no terminal needed after Node is installed):

- **Windows:** double-click **`start-feed-manager.cmd`**
- **macOS / Linux:** run **`./start-feed-manager.sh`**

The launcher installs dependencies on first run, then starts the tool and opens
it in your browser. Leave the window open while you use it; close it to stop.

**Or from a terminal:**

```bash
cd manager
npm install
npm run dev
```

Either way it opens `http://localhost:4318`. The dev server (Vite) also serves
the small API the UI talks to; there is no separate backend to start. By
default it edits the `feed.json` in the parent directory (this repo's root) and
runs git in that repo.

> **Is it an installed app?** No — it's a local web tool you launch on your own
> machine (the double-click launcher gives it a one-click feel). It is
> deliberately *not* packaged as a standalone `.exe`: it needs `git` (and,
> for auto-open/merge, the `gh` CLI) present on the machine anyway, and a local
> web UI keeps it a few small files instead of a bundled desktop app to
> maintain. If a true installed binary is ever wanted, the UI + local API could
> be wrapped in Tauri later, but it's overkill for an owner-only tool.

Environment overrides (rarely needed):

- `FEED_PATH` — absolute path to the `feed.json` to edit.
- `REPO_ROOT` — absolute path to the git repo to commit/push in.
- `BASE_BRANCH` — target/publish branch (default `main`).

### Security / operating assumptions

This is a **local, single-user** tool. The dev server exposes API endpoints
that **write, commit, and push `feed.json`**, so it is intended to run only on
the owner's own machine:

- Vite binds to **`localhost`** by default — do **not** run it with `--host` /
  `server.host`, which would expose those write/publish endpoints on your
  network.
- There is no auth in the tool; the security boundary is **git push
  permission** to this repo (see the root README's threat model), not the tool.
- Dependencies are kept current (`npm audit` is clean; the toolchain tracks
  Vite/Vitest majors). Run `npm audit` after dependency bumps.

### Publishing flow (branch → PR → merge)

1. `npm run dev`, edit / add / reorder entries. Errors block publish; warnings
   are advisory guardrails. (The tool bases the PR on `origin/main`, so you
   don't have to be on `main` or have it pulled — but pulling first keeps what
   you see in the editor in step with the live feed.)
2. Click **Publish → open PR**. The tool builds a `feed/update-<timestamp>`
   branch off the latest `origin/main` and opens (or links you to) a pull
   request into `main`.
3. On the PR, the **`feed-check`** CI validates the feed. When it's green,
   **merge the PR**.
4. GitHub Pages serves the new feed within a couple of minutes; running desktop
   apps pick it up on next startup.

> **`gh` CLI (optional but recommended):** if the [GitHub CLI](https://cli.github.com/)
> is installed and authenticated (`gh auth login`), the PR is opened
> automatically and the tool shows a "View pull request" link. Without it, the
> tool still pushes the branch and shows an "Open pull request" compare link to
> click. Either way the branch → PR → gate flow is preserved.
>
> This flow is what makes the `main` ruleset (require `feed-check`, require a PR)
> frictionless: you never push to `main` directly, so a bad feed can't slip
> past CI.

---

## Schema — the contract

The desktop app parses the feed in
[`packages/shared/src/announcements.ts`](https://github.com/KEBSULLC/time-capture)
(`parseAnnouncementFeed`). Entries this tool emits **must** match that parser.

An entry (`feed.json` → `announcements[]`):

```jsonc
{
  "id": "security-2026-07",          // required, unique — app tracks read-state by it
  "category": "security",            // security | ad | general  (Build 18 field)
  "severity": "critical",            // info | important | critical (styles the inbox chip)
  "audience": "all",                 // all | free | paid | pro | team | enterprise
  "min_version": "0.14.0",           // inclusive lower bound, or null
  "max_version": null,               // inclusive upper bound, or null
  "title": "Security update",        // required
  "body": "Plain text.\nNewlines preserved.",
  "links": [                          // https:// only
    { "label": "Advisory", "url": "https://example.com/a" }
  ],
  "published_at": "2026-07-03T00:00:00.000Z"
}
```

**Category → behavior** (the Build 18 model, see the `time-capture`
build thread `04-announcements-upsell.md`):

- **`security`** → force-pop blocking modal for **every** tier (pair with
  `severity: "critical"`).
- **`ad`** → daily pop for **Lite (ad-supported)** only, with an Upgrade
  button; inbox-only for everyone else.
- **`general`** → inbox only.

**Validation the tool enforces before it will save/publish:** required `id`
(unique) and `title`; valid `category` / `severity` / `audience` enums; valid
inclusive version strings (`min ≤ max`); **https-only** link URLs with labels;
a valid ISO `published_at`. Cross-field *warnings* (non-blocking) steer you
toward the intended model (e.g. a `security` entry that isn't `critical`, or an
`ad` targeted at a paid tier that would never pop).

### ⚠️ KEEP IN SYNC

[`src/schema/app-parser.ts`](src/schema/app-parser.ts) is a **vendored copy**
of the desktop app's feed parser — it is the tool's oracle for "will the app
accept this entry?". When the app's parser changes (in `time-capture`
`packages/shared/src/announcements.ts`), **re-copy the changed functions here
verbatim and re-run the tests**. Do not refactor the vendored copy — its only
job is to be a faithful mirror.

The one intentional addition over the *currently shipped* app parser is the
Build 18 `category` field. The shipped parser defensively ignores unknown
fields, so emitting `category` today is forward-compatible; Build 18's parser
reads it. When Build 18 lands, re-sync `app-parser.ts` from the real parser and
drop the fenced `category` block.

The [`roundtrip` test](src/schema/__tests__/roundtrip.test.ts) is what enforces
this: it authors an entry of each category, serializes it, and asserts the
vendored parser reads every field back unchanged. If the vendor drifts, that
test should fail.

---

## Guardrails — protecting `main`

The feed on `main` is what every install fetches, so two layers guard it:

1. **The tool won't emit an invalid feed.** Save/Publish are refused while any
   entry has a blocking error (the API returns `400`).
2. **CI validates `feed.json` on every PR into `main`.** The `feed-check`
   workflow (`.github/workflows/feed-check.yml`) runs `npm run check:feed`,
   which reuses the *same* vendored parser + validator and **fails** if the
   feed is unparseable, if the app would silently drop any entry (missing
   id/title), or if any schema rule is violated (bad enum, non-https link,
   invalid/inverted version range, duplicate id, bad date). No path filter, so
   it always runs — which lets it be a **required status check**.

Run it yourself anytime:

```bash
npm run check:feed          # validates ../feed.json
FEED_PATH=/path/to/feed.json npm run check:feed
```

**Recommended repo setting (must be done in GitHub — see the repo-root
guidance):** add a branch ruleset on `main` requiring the `feed-check /
validate` status check to pass, and blocking force-pushes and deletion. That
turns the CI gate from an after-the-fact detector into a merge gate.

## Develop / test

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest (watch)
npm run test:run    # vitest run (CI)
npm run build       # typecheck + production bundle
```

Tests:

- `src/schema/__tests__/` — the schema round-trip, authoring validation rules,
  serialization stability, and a mirror of the app parser's own cases.
- `server/__tests__/feedApi.integration.test.ts` — drives the real server
  middleware against a throwaway git repo with a local bare "remote" (no
  network, no `gh`): loading the feed from `origin/main`, publishing a PR
  branch off `origin/main` that contains **only** `feed.json`, the no-changes
  and invalid-feed paths, and that the working tree is never touched.

CI (`.github/workflows/manager-ci.yml`, at the repo root) runs typecheck +
tests + build on any change under `manager/`.

## Layout

```
manager/
├── index.html
├── start-feed-manager.cmd  # Windows double-click launcher
├── start-feed-manager.sh   # macOS / Linux launcher
├── vite.config.ts          # Vite + the local feed API plugin
├── server/
│   ├── feedApi.ts          # dev-server middleware: load / save / publish / merge (git + gh)
│   └── __tests__/          # integration test (real middleware + temp git repo)
├── scripts/check-feed.ts   # CI gate: validate feed.json against the schema
└── src/
    ├── App.tsx             # editor shell + state
    ├── api.ts              # client → /api/* helpers
    ├── components/         # EntryList, EntryForm, Preview, PublishBar
    └── schema/
        ├── app-parser.ts   # ⚠️ VENDORED app parser (KEEP IN SYNC)
        ├── types.ts        # editor working model + enums
        ├── serialize.ts    # canonical feed.json <-> AuthorEntry
        ├── authoring.ts    # validation (errors + guardrail warnings)
        └── __tests__/
```

> **Note on GitHub Pages:** this repo serves `feed.json` and the legal HTML
> pages statically. A repo-root `.nojekyll` file disables Jekyll processing so
> this `manager/` source tree can never interfere with the Pages build; the
> static files serve identically with or without it.
