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
| **Feed editor** | Loads the current `feed.json`, lists entries, and lets you **create / edit / delete / reorder** them. A form per entry covers every field (id, category, severity, audience, version range, links, dates) with live validation. |
| **Preview** | Shows how the selected entry will behave in the app: `security` → **blocking modal** (all tiers); `ad` → **daily pop** (Lite ad-supported) with an Upgrade button; `general` → **inbox** item. Title/body render as **plain text** — no HTML injection, mirroring the app's safe render. Also shows which tiers the entry is visible to (severity/audience rules) and the version range. |
| **Publish** | **Save feed.json** writes the file for a manual commit, or **Publish** writes it and runs `git add feed.json && git commit && git push` (push retried with backoff). Only `feed.json` is ever staged — never other working-tree changes. |

The emitted JSON is deterministic (canonical key order, 2-space indent,
trailing newline) so a bad publish is a one-line `git revert`.

---

## Run it

Requires Node 20+ (works on 22).

```bash
cd manager
npm install
npm run dev
```

This opens `http://localhost:4318`. The dev server (Vite) also serves the
small API the UI talks to; there is no separate backend to start. By default
it edits the `feed.json` in the parent directory (this repo's root) and runs
git in that repo.

Environment overrides (rarely needed):

- `FEED_PATH` — absolute path to the `feed.json` to edit.
- `REPO_ROOT` — absolute path to the git repo to commit/push in.

### Publishing flow

1. `npm run dev`, edit / add / reorder entries. Errors block save; warnings are
   advisory guardrails.
2. **Save feed.json** to write the file, or **Publish (commit + push)** to write
   *and* push to `origin` on the current branch.
3. GitHub Pages serves the new feed within a couple of minutes; running desktop
   apps pick it up on next startup.

> Publish pushes to whatever branch is checked out. For the live feed that is
> the repo's Pages branch (`main`). If you're iterating on a working branch,
> use **Save feed.json** and commit manually, or switch to `main` first.

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

## Develop / test

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest (watch)
npm run test:run    # vitest run (CI)
npm run build       # typecheck + production bundle
```

Tests live in `src/schema/__tests__/`: the schema round-trip, authoring
validation rules, serialization stability, and a mirror of the app parser's own
cases. CI (`.github/workflows/manager-ci.yml`, at the repo root) runs
typecheck + tests + build on any change under `manager/`.

## Layout

```
manager/
├── index.html
├── vite.config.ts          # Vite + the local feed API plugin
├── server/feedApi.ts       # dev-server middleware: load / save / publish (git)
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
