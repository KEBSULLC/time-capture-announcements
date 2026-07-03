import type { GitInfo } from '../api.js';

interface Props {
  git: GitInfo | null;
  feedRel: string;
  dirty: boolean;
  errorCount: number;
  warningCount: number;
  busy: boolean;
  message: string;
  status: { kind: 'ok' | 'error' | 'info'; text: string } | null;
  onMessage: (m: string) => void;
  onSave: () => void;
  onPublish: () => void;
}

export function PublishBar({
  git,
  feedRel,
  dirty,
  errorCount,
  warningCount,
  busy,
  message,
  status,
  onMessage,
  onSave,
  onPublish,
}: Props) {
  const blocked = errorCount > 0;
  return (
    <div className="panel publish-bar">
      <div className="publish-meta">
        <span className="muted">{feedRel}</span>
        {git?.isRepo && (
          <span className="muted">
            {' · '}branch <code>{git.branch}</code>
          </span>
        )}
        {dirty ? (
          <span className="badge-dirty">unsaved changes</span>
        ) : (
          <span className="muted"> · saved</span>
        )}
      </div>

      <div className="counts">
        {errorCount > 0 && <span className="badge-error">{errorCount} error(s)</span>}
        {warningCount > 0 && <span className="badge-warn">{warningCount} warning(s)</span>}
        {errorCount === 0 && warningCount === 0 && <span className="muted">schema valid ✓</span>}
      </div>

      <input
        className="commit-msg"
        value={message}
        placeholder="Commit message (e.g. Add security notice for 0.18.x)"
        onChange={(e) => onMessage(e.target.value)}
      />

      <div className="publish-actions">
        <button className="btn" disabled={blocked || busy} onClick={onSave} title="Write feed.json">
          Save feed.json
        </button>
        <button
          className="btn primary"
          disabled={blocked || busy || !git?.isRepo}
          onClick={onPublish}
          title="Write, commit & push to GitHub Pages"
        >
          {busy ? 'Working…' : 'Publish (commit + push)'}
        </button>
      </div>

      {blocked && (
        <p className="muted small">Fix all errors before saving or publishing.</p>
      )}
      {status && <div className={`status ${status.kind}`}>{status.text}</div>}
    </div>
  );
}
