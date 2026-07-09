import { useEffect, useMemo, useState } from 'react';
import type { AuthorEntry } from './schema/types.js';
import { emptyEntry } from './schema/types.js';
import { validateFeed } from './schema/authoring.js';
import { serializeFeed } from './schema/serialize.js';
import { getFeed, saveFeed, publishPr } from './api.js';
import type { GitInfo } from './api.js';
import { EntryList } from './components/EntryList.js';
import { EntryForm } from './components/EntryForm.js';
import { Preview } from './components/Preview.js';
import { PublishBar } from './components/PublishBar.js';

type Status = { kind: 'ok' | 'error' | 'info'; text: string; url?: string } | null;

export function App() {
  const [entries, setEntries] = useState<AuthorEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [feedRel, setFeedRel] = useState('feed.json');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getFeed()
      .then((res) => {
        setEntries(res.entries);
        setGit(res.git);
        setFeedRel(res.feedRel);
        setSavedSnapshot(serializeFeed(res.entries));
        setSelectedIndex(res.entries.length > 0 ? 0 : -1);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const validation = useMemo(() => validateFeed(entries), [entries]);
  const errorCounts = useMemo(
    () => validation.perEntry.map((list) => list.filter((i) => i.level === 'error').length),
    [validation],
  );
  const serialized = useMemo(() => serializeFeed(entries), [entries]);
  const dirty = serialized !== savedSnapshot;

  const patchEntry = (index: number, patch: Partial<AuthorEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const addEntry = () => {
    setEntries((prev) => {
      const next = [...prev, emptyEntry()];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setStatus(null);
  };

  const deleteEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex((cur) => {
      if (index < cur) return cur - 1;
      if (index === cur) return Math.max(-1, Math.min(cur, entries.length - 2));
      return cur;
    });
  };

  const moveEntry = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= entries.length) return;
    setEntries((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSelectedIndex((cur) => (cur === index ? target : cur === target ? index : cur));
  };

  const doSave = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await saveFeed(entries);
      if (res.ok) {
        setSavedSnapshot(serialized);
        const g = await getFeed();
        setGit(g.git);
        setStatus({ kind: 'ok', text: `Saved ${feedRel}.` });
      } else {
        setStatus({ kind: 'error', text: `Save rejected: ${res.reason ?? 'validation failed'}.` });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doPublish = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await publishPr(entries, message);
      if (res.ok && res.reason === 'no-changes') {
        setStatus({ kind: 'info', text: res.note ?? 'Nothing to publish.' });
      } else if (res.ok) {
        setSavedSnapshot(serialized);
        setStatus({ kind: 'ok', text: res.note ?? 'Published.', url: res.url });
      } else {
        setStatus({
          kind: 'error',
          text: `Publish failed at ${res.stage ?? '?'}: ${res.error ?? res.note ?? 'unknown error'}`,
        });
      }
      const g = await getFeed();
      setGit(g.git);
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const selected = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const selectedIssues = selectedIndex >= 0 ? validation.perEntry[selectedIndex] ?? [] : [];

  if (loadError) {
    return (
      <div className="app-error">
        <h1>Feed Manager</h1>
        <p className="status error">Could not load feed: {loadError}</p>
        <p className="muted">Is the dev server running with access to feed.json?</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Time Capture — Announcement Feed Manager</h1>
        <span className="muted">author &amp; publish {feedRel}</span>
      </header>

      <div className="columns">
        <div className="col col-left">
          <EntryList
            entries={entries}
            errorCounts={errorCounts}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onAdd={addEntry}
            onDelete={deleteEntry}
            onMove={moveEntry}
          />
          <PublishBar
            git={git}
            feedRel={feedRel}
            dirty={dirty}
            errorCount={validation.errorCount}
            warningCount={validation.warningCount}
            busy={busy}
            message={message}
            status={status}
            onMessage={setMessage}
            onSave={doSave}
            onPublish={doPublish}
          />
        </div>

        <div className="col col-mid">
          {selected ? (
            <EntryForm
              entry={selected}
              issues={selectedIssues}
              onChange={(patch) => patchEntry(selectedIndex, patch)}
            />
          ) : (
            <div className="panel empty-state">
              <p className="muted">Select an entry, or click “+ Add” to create one.</p>
            </div>
          )}
        </div>

        <div className="col col-right">{selected && <Preview entry={selected} />}</div>
      </div>
    </div>
  );
}
