import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Switch, Toggle } from '../../components/primitives';
import { Toast } from '../../components/Toast';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import {
  DEFAULT_JSON_OPTIONS,
  type JsonDiffData,
  type JsonDiffOptions,
  type JsonRow,
} from '../../../../engines/json/jsonDiff';
import type { EngineViewProps } from './engineViews';

const ROW_HEIGHT = 23;

/**
 * The structural JSON view (MD §13): a virtualised tree of rows plus the
 * normalisation rail that explains — and can undo — every suppressed difference.
 *
 * Normalisation options are not a display filter. Changing one re-runs the
 * engine, because the counts have to come from the comparison itself; a view
 * that hid rows locally would report numbers the engine never agreed to.
 */
export default function JsonTreeView({ result }: EngineViewProps) {
  const data = result.data as JsonDiffData;
  const rows = data.rows;

  const [onlyChanges, setOnlyChanges] = useState(true);
  const [expandAll, setExpandAll] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ row: JsonRow; x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const options: JsonDiffOptions = useMemo(
    () => ({ ...DEFAULT_JSON_OPTIONS, ...(storeOptions as Partial<JsonDiffOptions>) }),
    [storeOptions],
  );

  useEffect(() => {
    enableSearch('Filter by path or value…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  /** Parent row index for each row, from the depth column. */
  const parents = useMemo(() => {
    const out = new Array<number>(rows.length).fill(-1);
    const stack: number[] = [];
    rows.forEach((row, index) => {
      stack.length = row.depth;
      out[index] = row.depth === 0 ? -1 : (stack[row.depth - 1] ?? -1);
      stack[row.depth] = index;
    });
    return out;
  }, [rows]);

  /**
   * Which rows survive the filters. Search keeps the ancestors of a match so a
   * hit is never orphaned from its path; "only changes" drops unchanged leaves
   * and whole unchanged subtrees.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const keep = rows.map((row) => {
      if (onlyChanges && row.container === undefined && row.state === 'same') return false;
      if (onlyChanges && row.container !== undefined && (row.changed ?? 0) === 0) return false;
      if (needle === '') return true;
      return rowText(row).toLowerCase().includes(needle);
    });

    // Ancestors of a kept row stay, so the tree never loses its spine.
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (!keep[index]) continue;
      const parent = parents[index] ?? -1;
      if (parent >= 0) keep[parent] = true;
    }

    const out: Array<{ row: JsonRow; index: number }> = [];
    let hiddenBelow = -1;
    rows.forEach((row, index) => {
      if (hiddenBelow >= 0 && row.depth > hiddenBelow) return;
      hiddenBelow = -1;
      if (!keep[index]) return;
      out.push({ row, index });
      const isCollapsed = row.container !== undefined && !expandAll && collapsed.has(row.path);
      if (isCollapsed) hiddenBelow = row.depth;
    });
    return out;
  }, [rows, parents, onlyChanges, query, collapsed, expandAll]);

  /** Every non-`same` leaf is a navigable change (the strip's ‹ n/m ›). */
  const changeRows = useMemo(
    () =>
      visible
        .map((entry, position) => ({ ...entry, position }))
        .filter(
          ({ row }) => row.container === undefined && row.state !== 'same' && row.state !== 'ign',
        ),
    [visible],
  );

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

  useEffect(() => {
    register(changeRows.length, (changeIndex) => {
      const target = changeRows[changeIndex];
      if (target !== undefined) virtualizer.scrollToIndex(target.position, { align: 'center' });
    });
    return clearNav;
  }, [register, clearNav, changeRows, virtualizer]);

  const currentPosition = current === -1 ? -1 : (changeRows[current]?.position ?? -1);

  const toggleContainer = useCallback((path: string) => {
    setExpandAll(false);
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const copy = async (label: string, text: string): Promise<void> => {
    await window.devdiff.clipboard.write(text);
    setCopied(label);
    setMenu(null);
  };

  const shown = result.summary.added + result.summary.removed + result.summary.modified;
  const suppressed = result.summary.suppressed ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Toggle pressed={onlyChanges} onChange={setOnlyChanges}>
          Only changes
        </Toggle>
        <Toggle
          pressed={expandAll}
          onChange={(next) => {
            setExpandAll(next);
            if (next) setCollapsed(new Set());
          }}
        >
          Expand all
        </Toggle>
      </ToolbarSlot>

      <div className="dd-jsonwrap">
        <div className="dd-jsontree" ref={scrollRef} data-testid="json-tree">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = visible[item.index];
              if (entry === undefined) return null;
              return (
                <div
                  key={item.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TreeRow
                    row={entry.row}
                    collapsed={!expandAll && collapsed.has(entry.row.path)}
                    isCurrent={item.index === currentPosition}
                    onToggle={toggleContainer}
                    onMenu={(x, y) => setMenu({ row: entry.row, x, y })}
                  />
                </div>
              );
            })}
          </div>

          {visible.length === 0 && (
            <p className="dd-json-empty" data-testid="json-empty">
              {query.trim() === ''
                ? 'No differences under the current normalisation.'
                : `Nothing matches “${query}”.`}
            </p>
          )}
        </div>

        <aside className="dd-optpanel" data-testid="json-options">
          <div className="dd-opthd">Normalisation</div>
          <OptionRow
            title="Ignore key order"
            detail="Objects compare as sets of keys."
            checked={options.ignoreKeyOrder}
            onChange={(next) => void setOptions({ ignoreKeyOrder: next })}
            testId="opt-ignoreKeyOrder"
          />
          <OptionRow
            title="Ignore nulls"
            detail="Treat null and missing as equal."
            checked={options.ignoreNulls}
            onChange={(next) => void setOptions({ ignoreNulls: next })}
            testId="opt-ignoreNulls"
          />
          <OptionRow
            title="Ignore array order"
            detail="Match items by identity, not index."
            checked={options.ignoreArrayOrder}
            onChange={(next) => void setOptions({ ignoreArrayOrder: next })}
            testId="opt-ignoreArrayOrder"
          />

          <div className="dd-opthd">Ignored paths</div>
          <IgnoredPaths
            paths={options.ignorePaths}
            onChange={(next) => void setOptions({ ignorePaths: next })}
          />

          <div className="dd-opthd">Explain</div>
          <div className="dd-explain" data-testid="json-explain">
            {suppressed > 0 ? (
              <>
                {suppressed} of {shown + suppressed} differences were suppressed by normalisation.{' '}
                <button
                  type="button"
                  className="dd-linkish"
                  data-testid="show-suppressed"
                  onClick={() =>
                    void setOptions({
                      ignorePaths: [],
                      ignoreNulls: false,
                    })
                  }
                >
                  Show them →
                </button>
              </>
            ) : (
              'Nothing was suppressed: every difference above is real under the current normalisation.'
            )}
            <ul className="dd-notes">
              {result.normalizationNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {menu !== null && (
        <RowMenu
          row={menu.row}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onCopy={(label, text) => void copy(label, text)}
        />
      )}
      {copied !== null && (
        <Toast
          message={`${copied} copied`}
          testId="json-copied"
          timeoutMs={2500}
          onDismiss={() => setCopied(null)}
        />
      )}
    </div>
  );
}

/** Everything a search query can match against. */
function rowText(row: JsonRow): string {
  return [row.key, row.path, row.value, row.a, row.b, row.note].filter(Boolean).join(' ');
}

function TreeRow({
  row,
  collapsed,
  isCurrent,
  onToggle,
  onMenu,
}: {
  row: JsonRow;
  collapsed: boolean;
  isCurrent: boolean;
  onToggle: (path: string) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const isContainer = row.container !== undefined;
  // A container's own state is derived from its children, so marking it too
  // would double-count the change visually.
  const mark = isContainer
    ? ''
    : row.state === 'add'
      ? '+'
      : row.state === 'del'
        ? '−'
        : row.state === 'chg'
          ? '~'
          : row.state === 'type'
            ? '⚠'
            : '';

  return (
    <div
      className="dd-jrow"
      data-state={row.state}
      data-container={row.container ?? 'none'}
      data-current={isCurrent ? 'true' : 'false'}
      data-path={row.path}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.container !== undefined ? !collapsed : undefined}
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.left + 40, box.bottom);
        }
      }}
    >
      <span className="dd-jgutter" aria-hidden="true" />
      {Array.from({ length: row.depth }, (_, level) => (
        <span key={level} className="dd-jindent" aria-hidden="true" />
      ))}

      {row.container !== undefined ? (
        <button
          type="button"
          className="dd-jtwisty"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.key}`}
          onClick={() => onToggle(row.path)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="dd-jtwisty" aria-hidden="true" />
      )}

      <span className="dd-jmark" aria-hidden="true">
        {mark}
      </span>
      <span className="dd-jkey">{row.key}</span>
      <span className="dd-jcolon">:</span>

      {isContainer ? (
        <span className="dd-jnote">{row.container === 'arr' ? '[ … ]' : '{ … }'}</span>
      ) : row.state === 'chg' || row.state === 'type' ? (
        <>
          <span className="dd-jval" data-tone="old">
            {row.a}
          </span>
          <span className="dd-jarrow">→</span>
          <span className="dd-jval" data-tone="new">
            {row.b}
          </span>
        </>
      ) : row.state === 'add' ? (
        <span className="dd-jval" data-tone="new">
          {row.b}
        </span>
      ) : row.state === 'del' ? (
        <span className="dd-jval" data-tone="old">
          {row.a}
        </span>
      ) : row.value !== undefined ? (
        <span className="dd-jval">{row.value}</span>
      ) : (
        <span className="dd-jnote">{row.container === 'arr' ? '[ … ]' : '{ … }'}</span>
      )}

      {row.note !== undefined && <span className="dd-jnote">{row.note}</span>}
      {row.badge !== undefined && (
        <span className="dd-chip dd-jbadge" data-variant={row.badge.tone}>
          {row.badge.text}
        </span>
      )}
    </div>
  );
}

function OptionRow({
  title,
  detail,
  checked,
  onChange,
  testId,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <div className="dd-optrow" data-testid={testId}>
      <div className="dd-opttxt">
        <div className="dd-optt">{title}</div>
        <div className="dd-optd">{detail}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** Ignore globs, as removable chips plus an input that adds one. */
function IgnoredPaths({
  paths,
  onChange,
}: {
  paths: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    const value = draft.trim();
    setDraft('');
    setAdding(false);
    if (value !== '' && !paths.includes(value)) onChange([...paths, value]);
  };

  return (
    <div className="dd-pathchips" data-testid="ignored-paths">
      {paths.map((path) => (
        <span key={path} className="dd-pathchip">
          {path}
          <button
            type="button"
            aria-label={`Stop ignoring ${path}`}
            onClick={() => onChange(paths.filter((other) => other !== path))}
          >
            ✕
          </button>
        </span>
      ))}

      {adding ? (
        <input
          className="dd-pathinput"
          autoFocus
          value={draft}
          placeholder="meta.requestId"
          data-testid="path-input"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="dd-pathchip"
          data-add="true"
          data-testid="add-path"
          onClick={() => setAdding(true)}
        >
          + add path
        </button>
      )}
    </div>
  );
}

function RowMenu({
  row,
  x,
  y,
  onClose,
  onCopy,
}: {
  row: JsonRow;
  x: number;
  y: number;
  onClose: () => void;
  onCopy: (label: string, text: string) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const before = row.a ?? row.value;
  const after = row.b ?? row.value;

  return (
    <>
      <div className="dd-menu-scrim" onClick={onClose} aria-hidden="true" />
      <div className="dd-menu" style={{ left: x, top: y }} role="menu" data-testid="row-menu">
        <Button variant="ghost" size="sm" role="menuitem" onClick={() => onCopy('Path', row.path)}>
          Copy path
        </Button>
        <Button
          variant="ghost"
          size="sm"
          role="menuitem"
          disabled={before === undefined}
          onClick={() => onCopy('Before value', before ?? '')}
        >
          Copy value (before)
        </Button>
        <Button
          variant="ghost"
          size="sm"
          role="menuitem"
          disabled={after === undefined}
          onClick={() => onCopy('After value', after ?? '')}
        >
          Copy value (after)
        </Button>
      </div>
    </>
  );
}
