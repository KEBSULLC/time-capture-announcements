import type { AuthorEntry } from './schema/types.js';
import type { FeedValidation } from './schema/authoring.js';

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  feedDirty: boolean;
}

export interface FeedResponse {
  entries: AuthorEntry[];
  feedPath: string;
  feedRel: string;
  exists: boolean;
  /** 'origin' = loaded from the live published feed; 'working-tree' = local file. */
  source: 'origin' | 'working-tree';
  base: string;
  fetched: boolean;
  git: GitInfo;
}

export interface MergeResult {
  ok: boolean;
  mode?: 'auto' | 'immediate';
  reason?: string;
  stage?: string;
  branch?: string;
  note?: string;
  error?: string;
  output?: string;
}

export interface SaveResult {
  ok: boolean;
  reason?: string;
  validation?: FeedValidation;
}

export interface PublishPrResult {
  ok: boolean;
  stage?: string;
  opened?: boolean;
  branch?: string;
  base?: string;
  /** PR URL when opened, else a compare URL to open the PR manually. */
  url?: string;
  isCompare?: boolean;
  reason?: string;
  note?: string;
  error?: string;
  ghError?: string | null;
  validation?: FeedValidation;
}

export async function getFeed(): Promise<FeedResponse> {
  const res = await fetch('/api/feed');
  if (!res.ok) throw new Error(`Failed to load feed (${res.status})`);
  return res.json();
}

export async function saveFeed(entries: AuthorEntry[]): Promise<SaveResult> {
  const res = await fetch('/api/feed', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  return res.json();
}

export async function publishPr(
  entries: AuthorEntry[],
  message: string,
): Promise<PublishPrResult> {
  const res = await fetch('/api/publish-pr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries, message }),
  });
  return res.json();
}

export async function mergePr(branch: string): Promise<MergeResult> {
  const res = await fetch('/api/merge-pr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  return res.json();
}
