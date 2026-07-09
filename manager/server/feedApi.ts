import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
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
  /** Target/publish base branch. Defaults to "main". */
  base?: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const opts = {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 10 * 1024 * 1024,
    };
    execFile(cmd, args, opts, (error, stdout, stderr) => {
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
  const feedGitPath = feedRel.split(path.sep).join('/');
  const base = options.base?.trim() || 'main';

  const handlers: Record<
    string,
    (req: Connect.IncomingMessage, res: ServerResponse) => Promise<void>
  > = {
    // Load the feed the editor should start from: the LIVE published feed on
    // origin/<base>. We fetch first, then read origin/<base>:feed.json so the
    // editor reflects what installs actually see — regardless of local
    // working-tree state. Falls back to the local file when offline / not a
    // repo / the file isn't on origin yet.
    'GET /api/feed': async (_req, res) => {
      let entries: AuthorEntry[] = [];
      let exists = true;
      let source: 'origin' | 'working-tree' = 'working-tree';
      let fetched = false;
      let loaded = false;

      const isRepo = (await run('git', ['rev-parse', '--is-inside-work-tree'], repoRoot)).code === 0;
      if (isRepo) {
        fetched = (await run('git', ['fetch', 'origin', base], repoRoot)).code === 0;
        const show = await run('git', ['show', `origin/${base}:${feedGitPath}`], repoRoot);
        if (show.code === 0) {
          try {
            entries = loadFeed(JSON.parse(show.stdout));
            source = 'origin';
            loaded = true;
          } catch {
            // malformed feed on origin — fall through to the working tree
          }
        }
      }

      if (!loaded) {
        try {
          const text = await fs.readFile(feedPath, 'utf-8');
          entries = loadFeed(JSON.parse(text));
          source = 'working-tree';
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
          else throw e;
        }
      }

      const git = await gitStatus(repoRoot, feedRel);
      sendJson(res, 200, { entries, feedPath, feedRel, exists, source, base, fetched, git });
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

    // Publish via a branch + PR (Option C). Builds the update branch off the
    // TARGET BASE (origin/main), not the user's current branch, so the PR
    // contains ONLY the feed.json change and never unrelated local commits.
    // Uses git plumbing (blob → tree → commit → push a new ref), so the
    // working tree and current branch are never touched at all.
    'POST /api/publish-pr': async (req, res) => {
      const body = (await readBody(req)) as {
        entries?: AuthorEntry[];
        message?: string;
      };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const message = (body.message ?? '').trim() || 'Update announcement feed';

      // 1. Validate WITHOUT writing to disk (plumbing never dirties the tree).
      const validation = validateFeed(entries);
      if (validation.hasErrors) {
        sendJson(res, 400, { ok: false, stage: 'validation', validation });
        return;
      }
      const content = serializeFeed(entries);

      // 2. Must be a git repo. If not, at least write the file for the user.
      const isRepo = (await run('git', ['rev-parse', '--is-inside-work-tree'], repoRoot)).code === 0;
      if (!isRepo) {
        await fs.mkdir(path.dirname(feedPath), { recursive: true });
        await fs.writeFile(feedPath, content, 'utf-8');
        sendJson(res, 200, {
          ok: true,
          opened: false,
          reason: 'not-a-git-repo',
          note: 'feed.json was written; commit and open a PR manually.',
        });
        return;
      }

      // 3. Resolve the base commit — prefer origin/<base> (freshly fetched).
      await run('git', ['fetch', 'origin', base], repoRoot); // best effort
      let baseSha = '';
      for (const ref of [`origin/${base}`, base]) {
        const r = await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot);
        if (r.code === 0 && r.stdout.trim()) {
          baseSha = r.stdout.trim();
          break;
        }
      }
      if (!baseSha) {
        sendJson(res, 500, {
          ok: false,
          stage: 'base',
          error: `cannot resolve base branch "${base}" (no origin/${base} or local ${base}).`,
        });
        return;
      }
      const baseTree = (await run('git', ['rev-parse', `${baseSha}^{tree}`], repoRoot)).stdout.trim();

      // 4. Build the commit off baseSha in a scratch index — never touch HEAD.
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-mgr-'));
      const tmpFeed = path.join(tmpDir, 'feed.json');
      const idxEnv: NodeJS.ProcessEnv = { GIT_INDEX_FILE: path.join(tmpDir, 'index') };
      const idxPath = feedGitPath;
      try {
        await fs.writeFile(tmpFeed, content, 'utf-8');
        const blobRes = await run('git', ['hash-object', '-w', tmpFeed], repoRoot);
        if (blobRes.code !== 0) {
          sendJson(res, 500, { ok: false, stage: 'blob', error: blobRes.stderr || blobRes.stdout });
          return;
        }
        const blob = blobRes.stdout.trim();

        const rt = await run('git', ['read-tree', baseSha], repoRoot, idxEnv);
        if (rt.code !== 0) {
          sendJson(res, 500, { ok: false, stage: 'read-tree', error: rt.stderr || rt.stdout });
          return;
        }
        const ui = await run(
          'git',
          ['update-index', '--add', '--cacheinfo', `100644,${blob},${idxPath}`],
          repoRoot,
          idxEnv,
        );
        if (ui.code !== 0) {
          sendJson(res, 500, { ok: false, stage: 'update-index', error: ui.stderr || ui.stdout });
          return;
        }
        const wt = await run('git', ['write-tree'], repoRoot, idxEnv);
        if (wt.code !== 0) {
          sendJson(res, 500, { ok: false, stage: 'write-tree', error: wt.stderr || wt.stdout });
          return;
        }
        const newTree = wt.stdout.trim();

        // 5. No change vs base? Then there's nothing to publish.
        if (newTree === baseTree) {
          sendJson(res, 200, {
            ok: true,
            opened: false,
            reason: 'no-changes',
            note: `feed.json already matches ${base}; nothing to publish.`,
          });
          return;
        }

        const ct = await run('git', ['commit-tree', newTree, '-p', baseSha, '-m', message], repoRoot);
        if (ct.code !== 0) {
          sendJson(res, 500, { ok: false, stage: 'commit', error: ct.stderr || ct.stdout });
          return;
        }
        const commitSha = ct.stdout.trim();

        // 6. Push the new commit straight to a fresh branch ref on origin.
        const branch = `feed/update-${branchTimestamp()}`;
        let push: RunResult | null = null;
        const delays = [0, 2000, 4000, 8000, 16000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
          if (delays[attempt]) await sleep(delays[attempt]!);
          push = await run('git', ['push', 'origin', `${commitSha}:refs/heads/${branch}`], repoRoot);
          if (push.code === 0) break;
        }
        if (!push || push.code !== 0) {
          sendJson(res, 502, {
            ok: false,
            stage: 'push',
            branch,
            error: push?.stderr || push?.stdout || 'push failed',
            note: `Commit ${commitSha} is in your local object store — push it to ${branch} and open a PR manually.`,
          });
          return;
        }

        // 7. Resolve owner/repo for the PR / compare URL.
        const remote = await run('git', ['remote', 'get-url', 'origin'], repoRoot);
        const ownerRepo = remote.code === 0 ? parseOwnerRepo(remote.stdout.trim()) : null;
        const cmp = compareUrl(ownerRepo, base, branch);

        // 8. Try to open the PR with the GitHub CLI; fall back to compare URL.
        let prUrl: string | null = null;
        let ghError: string | null = null;
        const ghArgs = [
          'pr',
          'create',
          '--base',
          base,
          '--head',
          branch,
          '--title',
          message,
          '--body',
          `Automated feed update from the Feed Manager.\n\nBranch: ${branch}`,
        ];
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
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },

    // Merge an open feed PR into the base. Uses `gh pr merge --auto`, which
    // asks GitHub to merge ONLY once all required checks (feed-check) pass —
    // so the ruleset gate is fully preserved; this never bypasses it. Requires
    // the `gh` CLI (authenticated) and, for --auto, "Allow auto-merge" enabled
    // on the repo (falls back to an immediate merge, which only succeeds if the
    // PR is already green).
    'POST /api/merge-pr': async (req, res) => {
      const body = (await readBody(req)) as { branch?: string };
      const branch = (body.branch ?? '').trim();
      if (!branch) {
        sendJson(res, 400, { ok: false, error: 'branch is required' });
        return;
      }

      const ghVer = await run('gh', ['--version'], repoRoot);
      if (ghVer.code !== 0) {
        sendJson(res, 200, {
          ok: false,
          reason: 'no-gh',
          note: 'The GitHub CLI (gh) is not installed or not authenticated — merge the PR on GitHub.',
        });
        return;
      }

      const remote = await run('git', ['remote', 'get-url', 'origin'], repoRoot);
      const ownerRepo = remote.code === 0 ? parseOwnerRepo(remote.stdout.trim()) : null;
      const repoArgs = ownerRepo ? ['--repo', ownerRepo] : [];
      const mergeArgs = ['pr', 'merge', branch, '--squash', '--delete-branch', ...repoArgs];

      let mode: 'auto' | 'immediate' = 'auto';
      let merge = await run('gh', [...mergeArgs, '--auto'], repoRoot);
      // If the repo doesn't allow auto-merge, retry an immediate merge (only
      // succeeds if checks already passed).
      if (merge.code !== 0 && /auto[- ]?merge/i.test(`${merge.stderr}${merge.stdout}`)) {
        mode = 'immediate';
        merge = await run('gh', mergeArgs, repoRoot);
      }

      if (merge.code !== 0) {
        sendJson(res, 200, {
          ok: false,
          stage: 'merge',
          mode,
          branch,
          error: (merge.stderr || merge.stdout || 'merge failed').trim(),
          note: 'GitHub refused the merge. If feed-check is still running the PR merges when it passes (enable "Allow auto-merge" in repo settings); otherwise resolve the reported blocker on the PR.',
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        mode,
        branch,
        note:
          mode === 'auto'
            ? 'Auto-merge enabled — GitHub will merge into ' +
              base +
              ' once feed-check passes, then delete the branch.'
            : 'PR merged into ' + base + ' and branch deleted.',
        output: (merge.stdout || merge.stderr || '').trim(),
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
