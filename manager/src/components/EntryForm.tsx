import type { AuthorEntry } from '../schema/types.js';
import { AUDIENCES, CATEGORIES, SEVERITIES } from '../schema/types.js';
import type { Issue } from '../schema/authoring.js';

interface Props {
  entry: AuthorEntry;
  issues: Issue[];
  onChange: (patch: Partial<AuthorEntry>) => void;
}

/**
 * Options for an enum <select>. If the current value isn't one of the valid
 * options (e.g. a hand-edited feed had `category: "secirty"`), it is shown as
 * an extra "(invalid — fix)" option so the author can see the flagged value
 * rather than the select silently snapping to the first option.
 */
function optionsFor(current: string, valid: readonly string[]) {
  const list = current && !valid.includes(current) ? [current, ...valid] : valid;
  return list.map((v) => (
    <option key={v} value={v}>
      {valid.includes(v) ? v : `${v} (invalid — fix)`}
    </option>
  ));
}

function FieldIssues({ issues, field }: { issues: Issue[]; field: string }) {
  const mine = issues.filter((i) => i.field === field);
  if (mine.length === 0) return null;
  return (
    <div className="field-issues">
      {mine.map((i, k) => (
        <div key={k} className={`issue ${i.level}`}>
          {i.level === 'error' ? '⛔' : '⚠️'} {i.message}
        </div>
      ))}
    </div>
  );
}

export function EntryForm({ entry, issues, onChange }: Props) {
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) => {
    const links = entry.links.map((l, k) => (k === i ? { ...l, ...patch } : l));
    onChange({ links });
  };
  const addLink = () => onChange({ links: [...entry.links, { label: '', url: 'https://' }] });
  const removeLink = (i: number) => onChange({ links: entry.links.filter((_, k) => k !== i) });

  return (
    <div className="panel entry-form">
      <div className="panel-head">
        <h2>Edit entry</h2>
      </div>

      <label className="field">
        <span>id</span>
        <input
          value={entry.id}
          placeholder="security-2026-07"
          onChange={(e) => onChange({ id: e.target.value })}
        />
        <FieldIssues issues={issues} field="id" />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>category</span>
          <select
            value={entry.category}
            onChange={(e) => onChange({ category: e.target.value as AuthorEntry['category'] })}
          >
            {optionsFor(entry.category, CATEGORIES)}
          </select>
          <FieldIssues issues={issues} field="category" />
        </label>

        <label className="field">
          <span>severity</span>
          <select
            value={entry.severity}
            onChange={(e) => onChange({ severity: e.target.value as AuthorEntry['severity'] })}
          >
            {optionsFor(entry.severity, SEVERITIES)}
          </select>
          <FieldIssues issues={issues} field="severity" />
        </label>

        <label className="field">
          <span>audience</span>
          <select
            value={entry.audience}
            onChange={(e) => onChange({ audience: e.target.value as AuthorEntry['audience'] })}
          >
            {optionsFor(entry.audience, AUDIENCES)}
          </select>
          <FieldIssues issues={issues} field="audience" />
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>min_version (inclusive, blank = none)</span>
          <input
            value={entry.minVersion ?? ''}
            placeholder="0.18.0"
            onChange={(e) => onChange({ minVersion: e.target.value.trim() || null })}
          />
          <FieldIssues issues={issues} field="minVersion" />
        </label>
        <label className="field">
          <span>max_version (inclusive, blank = none)</span>
          <input
            value={entry.maxVersion ?? ''}
            placeholder="0.19.0"
            onChange={(e) => onChange({ maxVersion: e.target.value.trim() || null })}
          />
          <FieldIssues issues={issues} field="maxVersion" />
        </label>
      </div>

      <label className="field">
        <span>title</span>
        <input
          value={entry.title}
          placeholder="Short headline"
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <FieldIssues issues={issues} field="title" />
      </label>

      <label className="field">
        <span>body (plain text — newlines preserved, no HTML)</span>
        <textarea
          rows={5}
          value={entry.body}
          placeholder="Free-form text. Rendered as plain text in the app."
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <FieldIssues issues={issues} field="body" />
      </label>

      <div className="field">
        <span>links (https only)</span>
        {entry.links.map((l, i) => (
          <div className="link-row" key={i}>
            <input
              className="link-label"
              value={l.label}
              placeholder="Label"
              onChange={(e) => setLink(i, { label: e.target.value })}
            />
            <input
              className="link-url"
              value={l.url}
              placeholder="https://…"
              onChange={(e) => setLink(i, { url: e.target.value })}
            />
            <button className="icon-btn danger" title="Remove link" onClick={() => removeLink(i)}>
              ×
            </button>
            <FieldIssues issues={issues} field={`links[${i}].label`} />
            <FieldIssues issues={issues} field={`links[${i}].url`} />
          </div>
        ))}
        <button className="btn ghost" onClick={addLink}>
          + Add link
        </button>
      </div>

      <label className="field">
        <span>published_at (ISO 8601)</span>
        <div className="inline">
          <input
            value={entry.publishedAt}
            placeholder="2026-07-03T00:00:00.000Z"
            onChange={(e) => onChange({ publishedAt: e.target.value })}
          />
          <button
            className="btn ghost"
            onClick={() => onChange({ publishedAt: new Date().toISOString() })}
          >
            Now
          </button>
        </div>
        <FieldIssues issues={issues} field="publishedAt" />
      </label>
    </div>
  );
}
