import type { AuthorEntry } from '../schema/types.js';
import { renderModeForCategory } from '../schema/types.js';

const MODE_LABEL: Record<string, string> = {
  modal: 'modal',
  ad: 'daily ad',
  inbox: 'inbox',
};

interface Props {
  entries: AuthorEntry[];
  errorCounts: number[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDelete: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}

export function EntryList({
  entries,
  errorCounts,
  selectedIndex,
  onSelect,
  onAdd,
  onDelete,
  onMove,
}: Props) {
  return (
    <div className="panel entry-list">
      <div className="panel-head">
        <h2>Entries ({entries.length})</h2>
        <button className="btn" onClick={onAdd}>
          + Add
        </button>
      </div>
      <ul>
        {entries.map((e, i) => {
          const mode = renderModeForCategory(e.category);
          const errs = errorCounts[i] ?? 0;
          return (
            <li
              key={i}
              className={`entry-row ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelect(i)}
            >
              <div className="entry-row-main">
                <span className={`chip cat-${e.category}`}>{e.category}</span>
                <span className="entry-title">{e.title.trim() || <em>(untitled)</em>}</span>
              </div>
              <div className="entry-row-meta">
                <span className="muted">{e.id.trim() || '(no id)'}</span>
                <span className="muted"> · {MODE_LABEL[mode]}</span>
                {errs > 0 && (
                  <span className="badge-error" title={`${errs} error(s)`}>
                    {errs}
                  </span>
                )}
              </div>
              <div className="entry-row-actions" onClick={(ev) => ev.stopPropagation()}>
                <button
                  className="icon-btn"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() => onMove(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  disabled={i === entries.length - 1}
                  title="Move down"
                  onClick={() => onMove(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  onClick={() => onDelete(i)}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
        {entries.length === 0 && <li className="muted empty">No entries yet — click “+ Add”.</li>}
      </ul>
    </div>
  );
}
