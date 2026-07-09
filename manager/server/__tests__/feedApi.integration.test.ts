import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Connect, ViteDevServer } from 'vite';

import { feedApi } from '../feedApi.js';
import { serializeFeed } from '../../src/schema/serialize.js';
import { emptyEntry } from '../../src/schema/types.js';
import type { AuthorEntry } from '../../src/schema/types.js';

/**
 * Lightweight integration test: drives the REAL feedApi middleware against a
 * throwaway git repo with a local bare "remote" (no network, no `gh`). It
 * exercises the load-from-origin/main and publish-via-PR-off-origin/main
 * behavior end-to-end, plus proves the working tree is never touched.
 *
 * We invoke the plugin's middleware directly with fake req/res objects rather
 * than spinning a Vite/HTTP server — same code path, far less machinery.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();
}

function entry(overrides: Partial<AuthorEntry> = {}): AuthorEntry {
  return {
    ...emptyEntry('seed'),
    title: 'Seed',
    publishedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

// --- fake req/res so we can call the middleware without an HTTP server ------
function makeReq(method: string, url: string, body?: unknown): Connect.IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  } as unknown as Connect.IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  bodyText: string;
  setHeader(): void;
  end(chunk?: unknown): void;
}
function makeRes(): FakeRes {
  return {
    statusCode: 200,
    bodyText: '',
    setHeader() {},
    end(chunk?: unknown) {
      if (chunk !== undefined) this.bodyText = String(chunk);
    },
  };
}

let tmp: string;
let work: string;
let middleware: Connect.NextHandleFunction;

async function call(method: string, url: string, body?: unknown) {
  const req = makeReq(method, url, body);
  const res = makeRes();
  await middleware(req, res as unknown as ServerResponse, () => {
    res.statusCode = 404;
    res.end('{}');
  });
  return { status: res.statusCode, body: JSON.parse(res.bodyText || '{}') };
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'feed-it-'));
  const remote = path.join(tmp, 'remote.git');
  work = path.join(tmp, 'work');
  mkdirSync(work);

  git(tmp, 'init', '--bare', '-q', remote);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'remote', 'add', 'origin', remote);

  // Seed origin/main with one entry.
  const seed = serializeFeed([entry({ id: 'seed', title: 'Seed entry' })]);
  writeFileSync(path.join(work, 'feed.json'), seed, 'utf-8');
  git(work, 'add', 'feed.json');
  git(work, 'commit', '-q', '-m', 'seed');
  git(work, 'push', '-q', '-u', 'origin', 'main');

  // Build the plugin and capture its middleware via a fake ViteDevServer.
  const plugin = feedApi({ repoRoot: work });
  const fakeServer = {
    config: { logger: { info() {} } },
    middlewares: {
      use(fn: Connect.NextHandleFunction) {
        middleware = fn;
      },
    },
  } as unknown as ViteDevServer;
  (plugin.configureServer as (s: ViteDevServer) => void)(fakeServer);
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('feedApi integration (real middleware + temp git repo)', () => {
  it('GET /api/feed loads the live feed from origin/main', async () => {
    const { status, body } = await call('GET', '/api/feed');
    expect(status).toBe(200);
    expect(body.source).toBe('origin');
    expect(body.base).toBe('main');
    expect(body.entries.map((e: AuthorEntry) => e.id)).toEqual(['seed']);
  });

  it('GET /api/git-status reports the repo + branch', async () => {
    const { body } = await call('GET', '/api/git-status');
    expect(body.isRepo).toBe(true);
    expect(body.branch).toBe('main');
  });

  it('publish-pr builds a branch off origin/main containing ONLY feed.json', async () => {
    const entries = [entry({ id: 'seed', title: 'Seed entry' }), entry({ id: 'new', title: 'New' })];
    const { status, body } = await call('POST', '/api/publish-pr', { entries, message: 'Add new' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reason).not.toBe('no-changes');
    expect(body.branch).toMatch(/^feed\/update-/);

    // Verify on the remote: exactly one commit ahead of main, only feed.json.
    git(work, 'fetch', '-q', 'origin', body.branch);
    expect(git(work, 'rev-list', '--count', `origin/main..origin/${body.branch}`)).toBe('1');
    expect(git(work, 'diff', '--name-only', `origin/main..origin/${body.branch}`)).toBe('feed.json');
  });

  it('publish-pr reports no-changes when the feed already matches origin/main', async () => {
    const entries = [entry({ id: 'seed', title: 'Seed entry' })]; // identical to origin/main
    const { body } = await call('POST', '/api/publish-pr', { entries, message: 'noop' });
    expect(body.ok).toBe(true);
    expect(body.reason).toBe('no-changes');
  });

  it('publish-pr rejects an invalid feed without creating anything', async () => {
    const bad = [entry({ id: 'bad', links: [{ label: 'x', url: 'http://insecure.com' }] })];
    const { status, body } = await call('POST', '/api/publish-pr', { entries: bad, message: 'bad' });
    expect(status).toBe(400);
    expect(body.stage).toBe('validation');
  });

  it('never touches the working tree or current branch', async () => {
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(git(work, 'branch', '--show-current')).toBe('main');
    expect(git(work, 'branch', '--list', 'feed/*')).toBe('');
  });

  it('merge-pr degrades cleanly (400 on missing branch)', async () => {
    const { status } = await call('POST', '/api/merge-pr', {});
    expect(status).toBe(400);
  });
});
