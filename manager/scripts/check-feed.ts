/*
 * Validate the repo's live feed.json against the schema BEFORE it can reach a
 * running install. Run in CI (see .github/workflows/feed-check.yml) on every
 * PR/push touching the feed, and locally with `npm run check:feed`.
 *
 * It fails (exit 1) if:
 *   - feed.json is missing or not valid JSON,
 *   - the app parser would silently DROP any entry (missing id/title, etc.) —
 *     "dropped" means installs never see it, which is almost always a mistake,
 *   - the authoring validator reports any blocking error (bad enum, non-https
 *     link, invalid/inverted version range, duplicate id, bad date).
 *
 * It reuses the SAME vendored parser + validator the editor uses, so there is
 * no second schema to keep in sync.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAnnouncementFeed } from '../src/schema/app-parser.js';
import { loadFeed } from '../src/schema/serialize.js';
import { validateFeed } from '../src/schema/authoring.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const feedPath = process.env.FEED_PATH
  ? path.resolve(process.env.FEED_PATH)
  : process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(repoRoot, 'feed.json');

function fail(msg: string): never {
  console.error(`\n✖ feed check FAILED: ${msg}\n`);
  process.exit(1);
}

let text: string;
try {
  text = readFileSync(feedPath, 'utf-8');
} catch {
  fail(`cannot read ${feedPath}`);
}

let raw: unknown;
try {
  raw = JSON.parse(text);
} catch (e) {
  fail(`${feedPath} is not valid JSON: ${(e as Error).message}`);
}

// The raw announcements array (mirror the parser's own unwrapping).
const rawList: unknown[] = Array.isArray(raw)
  ? raw
  : Array.isArray((raw as Record<string, unknown>)?.announcements)
    ? ((raw as Record<string, unknown>).announcements as unknown[])
    : fail('feed must be an array or an object with an "announcements" array');

// 1) Would the app drop any entry? Compare raw count to parsed count.
const parsed = parseAnnouncementFeed(raw);
if (parsed.length !== rawList.length) {
  const droppedIdx = rawList
    .map((item, i) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id.trim() : '';
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      return !id || !title ? `#${i} (id="${id}", title="${title}")` : null;
    })
    .filter(Boolean);
  fail(
    `the app parser would drop ${rawList.length - parsed.length} entr${
      rawList.length - parsed.length === 1 ? 'y' : 'ies'
    } (missing id/title or not an object): ${droppedIdx.join(', ') || '(unknown)'}`,
  );
}

// 2) Schema validation via the authoring validator (errors block; warnings don't).
const entries = loadFeed(raw);
const result = validateFeed(entries);
if (result.hasErrors) {
  console.error(`\n✖ feed check FAILED: ${result.errorCount} schema error(s):\n`);
  result.perEntry.forEach((issues, i) => {
    const errs = issues.filter((x) => x.level === 'error');
    if (errs.length === 0) return;
    const id = entries[i]?.id || `#${i}`;
    for (const e of errs) console.error(`  • [${id}] ${e.field}: ${e.message}`);
  });
  console.error('');
  process.exit(1);
}

const warnCount = result.warningCount;
console.log(
  `✔ feed check passed — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} valid` +
    (warnCount ? `, ${warnCount} warning(s) (non-blocking)` : '') +
    `\n  ${feedPath}`,
);
