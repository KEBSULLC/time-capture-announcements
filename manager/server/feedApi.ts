import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import type { ServerResponse } from 'node:http';

import { loadFeed, serializeFeed } from '../src/schema/serialize.js';
import { validateFeed } from '../src/schema/authoring.js';
import type { AuthorEntry } from '../src/schema/types.js';

export interface FeedApiOptions {
  /** Absolute path to the repo root (where the .git dir and feed.json live). */
  repoRoot: string;
  /** Absolute path to feed.json. Defaults to <repoRoot>/feed.json. */
  feedPath?: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

async function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function gitStatus(repoRoot: string, feedRel: string) {
  const branchRes = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : null;
  // exit 1 => feed.json differs from HEAD (uncommitted change); 0 => clean.
  const dirtyRes = await run('git', ['diff', '--quiet', '--', feedRel], repoRoot);
  const feedDirty = dirtyRes.code !== 0;
  const isRepo = branch !== null;
  return { isRepo, branch, feedDirty };
}

/**
 * Persist entries to feed.json after validating. Returns the validation so the
 * caller can refuse to write when there are blocking errors.
 */
async function writeFeed(feedPath: string, entries: AuthorEntry[]) {
  const validation = validateFeed(entries);
  if (validation.hasErrors) return { wrote: false, validation };
  await fs.mkdir(path.dirname(feedPath), { recursive: true });
  await fs.writeFile(feedPath, serializeFeed(entries), 'utf-8');
  return { wrote: true, validation };
}

/** Extract "owner/repo" from a git remote URL (https, ssh, or proxied http). */
export function parseOwnerRepo(remote: string): string | null {
  let s = remote.trim().replace(/\.git$/, '');
  const ssh = s.match(/^[^@\s]+@[^:]+:(.+)$/);
  if (ssh) {
    s = ssh[1]!;
  } else {
    const url = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i);
    if (url) s = url[1]!;
  }
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join('/');
}

function branchTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

function compareUrl(ownerRepo: string | null, base: string, branch: string): string | null {
  if (!ownerRepo) return null;
  return `https://github.com/${ownerRepo}/compare/${encodeURIComponent(
    base,
  )}...${encodeURIComponent(branch)}?expand=1`;
}

export function feedApi(options: FeedApiOptions): Plugin {
  const repoRoot = path.resolve(options.repoRoot);
  const feedPath = path.resolve(options.feedPath ?? path.join(repoRoot, 'feed.json'));
  const feedRel = path.relative(repoRoot, feedPath) || 'feed.json';

  const handlers: Record<
    string,
    (req: Connect.IncomingMessage, res: ServerResponse) => Promise<void>
  > = {
    'GET /api/feed': async (_req, res) => {
      let entries: AuthorEntry[] = [];
      let exists = true;
      try {
        const text = await fs.readFile(feedPath, 'utf-8');
        entries = loadFeed(JSON.parse(text));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
        else throw e;
      }
      const git = await gitStatus(repoRoot, feedRel);
      sendJson(res, 200, { entries, feedPath, feedRel, exists, git });
    },

    'GET /api/git-status': async (_req, res) => {
      sendJson(res, 200, await gitStatus(repoRoot, feedRel));
    },

    'PUT /api/feed': async (req, res) => {
      const body = (await readBody(req)) as { entries?: AuthorEntry[] };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const { wrote, validation } = await writeFeed(feedPath, entries);
      if (!wrote) {
        sendJson(res, 400, { ok: false, reason: 'validation', validation });
        return;
      }
      sendJson(res, 200, { ok: true, feedPath, validation });
    },

    // Publish via a short-lived branch + PR (Option C). Writes feed.json,
    // creates a `feed/update-<ts>` branch off the current HEAD, commits +
    // pushes it, and opens a PR into `base` (via `gh` if available, else it
    // returns a ready compare URL). Leaves the working tree back on the
    // original branch so nothing lands directly on main.
    'POST /api/publish-pr': async (req, res) => {
      const body = (await readBody(req)) as {
        entries?: AuthorEntry[];
        message?: string;
        base?: string;
      };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const message = (body.message ?? '').trim() || 'Update announcement feed';
      const base = (body.base ?? '').trim() || 'main';

      const { wrote, validation } = await writeFeed(feedPath, entries);
      if (!wrote) {
        sendJson(res, 400, { ok: false, stage: 'validation', validation });
        return;
      }

      const status = await gitStatus(repoRoot, feedRel);
      if (!status.isRepo) {
        sendJson(res, 200, {
          ok: true,
          opened: false,
          reason: 'not-a-git-repo',
          note: 'feed.json was written; commit and open a PR manually.',
        });
        return;
      }

      const original = status.branch ?? 'HEAD';
      const branch = `feed/update-${branchTimestamp()}`;

      const checkout = await run('git', ['checkout', '-b', branch], repoRoot);
      if (checkout.code !== 0) {
        sendJson(res, 500, { ok: false, stage: 'branch', error: checkout.stderr || checkout.stdout });
        return;
      }

      await run('git', ['add', '--', feedRel], repoRoot);
      const staged = await run('git', ['diff', '--cached', '--quiet', '--', feedRel], repoRoot);
      if (staged.code === 0) {
        // Nothing changed — tear the branch back down and report cleanly.
        await run('git', ['checkout', original], repoRoot);
        await run('git', ['branch', '-D', branch], repoRoot);
        sendJson(res, 200, {
          ok: true,
          opened: false,
          reason: 'no-changes',
          note: 'feed.json already matches HEAD; nothing to publish.',
        });
        return;
      }

      const commit = await run('git', ['commit', '-m', message, '--', feedRel], repoRoot);
      if (commit.code !== 0) {
        await run('git', ['checkout', '-f', original], repoRoot);
        await run('git', ['branch', '-D', branch], repoRoot);
        sendJson(res, 500, { ok: false, stage: 'commit', error: commit.stderr || commit.stdout });
        return;
      }

      let push: RunResult | null = null;
      const delays = [0, 2000, 4000, 8000, 16000];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await sleep(delays[attempt]!);
        push = await run('git', ['push', '-u', 'origin', branch], repoRoot);
        if (push.code === 0) break;
      }

      // Return the working tree to where the user was, regardless of push result.
      await run('git', ['checkout', original], repoRoot);

      if (!push || push.code !== 0) {
        sendJson(res, 502, {
          ok: false,
          stage: 'push',
          branch,
          error: push?.stderr || push?.stdout || 'push failed',
          note: `The commit is on local branch ${branch} — push it and open a PR manually.`,
        });
        return;
      }

      // Resolve owner/repo from the origin remote for the PR / compare URL.
      const remote = await run('git', ['remote', 'get-url', 'origin'], repoRoot);
      const ownerRepo = remote.code === 0 ? parseOwnerRepo(remote.stdout.trim()) : null;
      const cmp = compareUrl(ownerRepo, base, branch);

      // Try to open the PR with the GitHub CLI; fall back to the compare URL.
      let prUrl: string | null = null;
      let ghError: string | null = null;
      const ghArgs = ['pr', 'create', '--base', base, '--head', branch, '--title', message, '--body', `Automated feed update from the Feed Manager.\n\nBranch: ${branch}`];
      if (ownerRepo) ghArgs.push('--repo', ownerRepo);
      const gh = await run('gh', ghArgs, repoRoot);
      if (gh.code === 0) {
        prUrl = gh.stdout.trim().split('\n').filter(Boolean).pop() ?? null;
      } else {
        ghError = (gh.stderr || gh.stdout || '').trim() || null;
      }

      sendJson(res, 200, {
        ok: true,
        opened: prUrl !== null,
        branch,
        base,
        url: prUrl ?? cmp,
        isCompare: prUrl === null,
        note:
          prUrl !== null
            ? 'Pull request opened. feed-check will validate it; merge when green.'
            : cmp
              ? 'Branch pushed. Open the pull request from the link (gh CLI not available or not authed).'
              : `Branch ${branch} pushed. Open a PR into ${base} manually.`,
        ghError,
      });
    },

    'POST /api/publish': async (req, res) => {
      const body = (await readBody(req)) as { entries?: AuthorEntry[]; message?: string };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const message = (body.message ?? '').trim() || 'Update announcement feed';

      const { wrote, validation } = await writeFeed(feedPath, entries);
      if (!wrote) {
        sendJson(res, 400, { ok: false, stage: 'validation', validation });
        return;
      }

      const status = await gitStatus(repoRoot, feedRel);
      if (!status.isRepo) {
        sendJson(res, 200, {
          ok: true,
          committed: false,
          pushed: false,
          reason: 'not-a-git-repo',
          note: 'feed.json was written; commit and push it manually.',
        });
        return;
      }

      // Stage ONLY feed.json — never sweep unrelated working-tree changes.
      const add = await run('git', ['add', '--', feedRel], repoRoot);
      if (add.code !== 0) {
        sendJson(res, 500, { ok: false, stage: 'add', error: add.stderr || add.stdout });
        return;
      }

      // Anything staged? (exit 1 => staged diff present)
      const staged = await run('git', ['diff', '--cached', '--quiet', '--', feedRel], repoRoot);
      if (staged.code === 0) {
        sendJson(res, 200, {
          ok: true,
          committed: false,
          pushed: false,
          reason: 'no-changes',
          note: 'feed.json is already up to date with HEAD; nothing to publish.',
        });
        return;
      }

      const commit = await run('git', ['commit', '-m', message, '--', feedRel], repoRoot);
      if (commit.code !== 0) {
        sendJson(res, 500, { ok: false, stage: 'commit', error: commit.stderr || commit.stdout });
        return;
      }

      const branch = status.branch ?? 'HEAD';
      let push: RunResult | null = null;
      const delays = [0, 2000, 4000, 8000, 16000];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await sleep(delays[attempt]!);
        push = await run('git', ['push', '-u', 'origin', branch], repoRoot);
        if (push.code === 0) break;
      }

      if (!push || push.code !== 0) {
        sendJson(res, 502, {
          ok: false,
          stage: 'push',
          committed: true,
          pushed: false,
          error: push?.stderr || push?.stdout || 'push failed',
          note: 'The commit is on your local branch — retry the push or push manually.',
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        committed: true,
        pushed: true,
        branch,
        message,
        output: push.stdout || push.stderr,
      });
    },
  };

  function attach(server: ViteDevServer) {
    server.config.logger.info(
      `\n  [feed-manager] editing ${feedRel}\n  [feed-manager] repo root ${repoRoot}\n`,
    );
    server.middlewares.use(async (req, res, next) => {
      const url = (req.url ?? '').split('?')[0];
      if (!url || !url.startsWith('/api/')) return next();
      const key = `${req.method} ${url}`;
      const handler = handlers[key];
      if (!handler) return sendJson(res, 404, { ok: false, error: `no route ${key}` });
      try {
        await handler(req, res);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: (e as Error).message });
      }
    });
  }

  return {
    name: 'feed-manager-api',
    configureServer: attach,
    configurePreviewServer: attach as unknown as Plugin['configurePreviewServer'],
  };
}
