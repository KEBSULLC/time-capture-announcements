import type { AuthorEntry } from '../schema/types.js';
import { renderModeForCategory } from '../schema/types.js';
import type { LicenseTier } from '../schema/app-parser.js';
import { isVisibleToUser } from '../schema/app-parser.js';

const BEHAVIOR: Record<AuthorEntry['category'], string> = {
  security: 'Blocking modal — force-pops for every tier, cannot be dismissed by clicking away.',
  ad: 'Daily pop — shown once per day to Lite (ad-supported) only. Inbox-only for everyone else.',
  general: 'Inbox only — appears in the announcements list with an unread badge.',
};

const TIERS: { tier: LicenseTier; label: string }[] = [
  { tier: 'free', label: 'Lite' },
  { tier: 'pro', label: 'Pro' },
  { tier: 'team', label: 'Team' },
  { tier: 'enterprise', label: 'Enterprise' },
];

/** Plain-text body — newlines preserved, no HTML injection (mirrors the app). */
function Body({ text }: { text: string }) {
  return <div className="preview-body">{text}</div>;
}

function LinkButtons({ entry }: { entry: AuthorEntry }) {
  if (entry.links.length === 0) return null;
  return (
    <div className="preview-links">
      {entry.links.map((l, i) => (
        <span className="preview-link" key={i} title={l.url}>
          {l.label.trim() || '(unlabeled link)'}
        </span>
      ))}
    </div>
  );
}

function ModalPreview({ entry }: { entry: AuthorEntry }) {
  return (
    <div className="mock-scrim">
      <div className={`mock-modal sev-${entry.severity}`}>
        <div className="mock-modal-title">{entry.title.trim() || '(untitled)'}</div>
        <Body text={entry.body} />
        <LinkButtons entry={entry} />
        <div className="mock-actions">
          <button className="btn primary">Got it</button>
        </div>
      </div>
    </div>
  );
}

function AdPreview({ entry }: { entry: AuthorEntry }) {
  return (
    <div className="mock-ad-wrap">
      <div className="mock-ad">
        <div className="mock-ad-head">
          <span className="chip cat-ad">upgrade</span>
          <button className="icon-btn" title="Dismiss">
            ×
          </button>
        </div>
        <div className="mock-modal-title">{entry.title.trim() || '(untitled)'}</div>
        <Body text={entry.body} />
        <LinkButtons entry={entry} />
        <div className="mock-actions">
          <button className="btn primary">Upgrade</button>
        </div>
      </div>
    </div>
  );
}

function InboxPreview({ entry }: { entry: AuthorEntry }) {
  return (
    <div className="mock-inbox">
      <div className="mock-inbox-row">
        <span className={`chip sev-chip sev-${entry.severity}`}>{entry.severity}</span>
        <div className="mock-inbox-text">
          <div className="mock-modal-title">{entry.title.trim() || '(untitled)'}</div>
          <Body text={entry.body} />
          <LinkButtons entry={entry} />
        </div>
        <span className="unread-dot" title="unread" />
      </div>
    </div>
  );
}

export function Preview({ entry }: { entry: AuthorEntry }) {
  const mode = renderModeForCategory(entry.category);
  return (
    <div className="panel preview">
      <div className="panel-head">
        <h2>Preview</h2>
        <span className={`chip cat-${entry.category}`}>{mode}</span>
      </div>

      <p className="behavior-note">{BEHAVIOR[entry.category]}</p>

      <div className="preview-stage">
        {mode === 'modal' && <ModalPreview entry={entry} />}
        {mode === 'ad' && <AdPreview entry={entry} />}
        {mode === 'inbox' && <InboxPreview entry={entry} />}
      </div>

      <div className="visibility">
        <span className="visibility-label">Visible to (by tier, per severity/audience rules):</span>
        <div className="visibility-tiers">
          {TIERS.map(({ tier, label }) => {
            const visible = isVisibleToUser(
              { audience: entry.audience, severity: entry.severity },
              tier,
            );
            return (
              <span key={tier} className={`tier-pill ${visible ? 'yes' : 'no'}`}>
                {visible ? '✓' : '✕'} {label}
              </span>
            );
          })}
        </div>
        <p className="muted small">
          Version range:{' '}
          {entry.minVersion || '−∞'} … {entry.maxVersion || '+∞'} (inclusive). Category drives
          modal/ad/inbox; severity/audience drive who sees it.
        </p>
      </div>
    </div>
  );
}
