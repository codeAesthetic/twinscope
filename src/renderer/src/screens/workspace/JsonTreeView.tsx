import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Chip, Seg, Switch, Toggle } from '../../components/primitives';
import { Toast } from '../../components/Toast';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { useViewModeStore } from '../../stores/viewMode';
import {
  afterText,
  beforeText,
  buildDisplayRows,
  containerText,
  JSON_VIEW_MODES,
  markFor,
  toneFor,
  type JsonDisplayRow,
  type JsonViewMode,
} from '../../lib/jsonView';
import { useViewModeCycle } from '../../lib/viewMode';
import {
  DEFAULT_JSON_OPTIONS,
  type JsonDiffData,
  type JsonDiffOptions,
  type JsonRow,
} from '../../../../engines/json/jsonDiff';
import type { EngineViewProps } from './engineViews';

const ROW_HEIGHT = 23;

/**
 * The structural JSON view (MD §13): the diff in five presentations, plus the
 * normalisation rail that explains — and can undo — every suppressed difference.
 *
 * Two rules shape this file.
 *
 * **Normalisation options are not a display filter.** Changing one re-runs the
 * engine, because the counts have to come from the comparison itself; a view
 * that hid rows locally would report numbers the engine never agreed to.
 *
 * **A view mode is not a second diff.** Side-by-side, unified, inline and tree
 * are four renderings of one row list from one structural walk, so the summary
 * strip describes every one of them. `raw` is deliberately not a diff at all: it
 * shows the two documents as they arrived.
 *
 * **Deviation from the mockup (owner-directed):** `#s-json`'s seg is
 * `Tree | Side-by-side | Raw` with Tree selected. Side-by-side is the default
 * here, and unified and inline were added for parity with the text view.
 */
export default function JsonTreeView({ result }: EngineViewProps) {
  const data = result.data as JsonDiffData;
  const rows = data.rows;

  /**
   * The mode outlives this component on purpose: a normalisation toggle re-runs
   * the engine, which unmounts and remounts the view (see `stores/viewMode.ts`).
   */
  const rawMode = useViewModeStore((state) => state.modeFor(result.engineId, 'side'));
  const mode = (JSON_VIEW_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as JsonViewMode)
    : 'side';
  const setStoredMode = useViewModeStore((state) => state.set);
  const cycleStoredMode = useViewModeStore((state) => state.cycle);
  const setMode = useCallback(
    (next: JsonViewMode) => setStoredMode(result.engineId, next),
    [setStoredMode, result.engineId],
  );
  const cycleMode = useCallback(
    () => cycleStoredMode(result.engineId, JSON_VIEW_MODES),
    [cycleStoredMode, result.engineId],
  );

  const [onlyChanges, setOnlyChanges] = useState(true);
  const [expandAll, setExpandAll] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ row: JsonRow; x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
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

  useViewModeCycle(cycleMode);

  /**
   * Raw has no rows to filter, so the box says it cannot search rather than
   * accepting a query and doing nothing (the rule `WorkspaceSearch` states).
   */
  useEffect(() => {
    if (mode === 'raw') {
      disableSearch();
      return;
    }
    enableSearch('Filter by path or value…');
    return disableSearch;
  }, [mode, enableSearch, disableSearch]);

  const visible = useMemo(
    () => buildDisplayRows(rows, { mode, onlyChanges, query, collapsed, expandAll }),
    [rows, mode, onlyChanges, query, collapsed, expandAll],
  );

  /**
   * Every non-`same` leaf is a navigable change (the strip's ‹ n/m ›).
   *
   * `anchor` is what keeps the count mode-independent: unified draws a
   * modification as two rows, and both of them are still one change.
   */
  const changeRows = useMemo(
    () =>
      visible
        .map((entry, position) => ({ ...entry, position }))
        .filter(
          ({ row, anchor }) =>
            anchor && row.container === undefined && row.state !== 'same' && row.state !== 'ign',
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
    await window.twinscope.clipboard.write(text);
    setCopied(label);
    setMenu(null);
  };

  const shown = result.summary.added + result.summary.removed + result.summary.modified;
  const suppressed = result.summary.suppressed ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="JSON view mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'side', label: 'Side-by-side' },
            { value: 'unified', label: 'Unified' },
            { value: 'inline', label: 'Inline' },
            { value: 'tree', label: 'Tree' },
            { value: 'raw', label: 'Raw' },
          ]}
        />
        {mode !== 'raw' && (
          <Toggle pressed={onlyChanges} onChange={setOnlyChanges}>
            Only changes
          </Toggle>
        )}
        {/* Containers only exist in the tree, so nothing else has anything to expand. */}
        {mode === 'tree' && (
          <Toggle
            pressed={expandAll}
            onChange={(next) => {
              setExpandAll(next);
              if (next) setCollapsed(new Set());
            }}
          >
            Expand all
          </Toggle>
        )}
      </ToolbarSlot>

      <div className="dd-jsonwrap">
        {/* The testid stays `json-tree` in every mode: it addresses the JSON
            view, and three specs plus the media captures already point at it. */}
        <div className="dd-jsontree" ref={scrollRef} data-testid="json-tree" data-mode={mode}>
          {mode === 'raw' ? (
            <RawPanes a={a} b={b} />
          ) : (
            <>
              {mode === 'side' && (
                <div className="dd-diff-header">
                  <div>
                    <b>{a?.name}</b>
                    {result.summary.removed > 0 && (
                      <Chip variant="del">－{result.summary.removed}</Chip>
                    )}
                  </div>
                  <div>
                    <b>{b?.name}</b>
                    {result.summary.added > 0 && (
                      <Chip variant="add">＋{result.summary.added}</Chip>
                    )}
                  </div>
                </div>
              )}

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
                      {mode === 'tree' ? (
                        <TreeRow
                          row={entry.row}
                          collapsed={!expandAll && collapsed.has(entry.row.path)}
                          isCurrent={item.index === currentPosition}
                          onToggle={toggleContainer}
                          onMenu={(x, y) => setMenu({ row: entry.row, x, y })}
                        />
                      ) : mode === 'side' ? (
                        <SplitRow
                          entry={entry}
                          isCurrent={item.index === currentPosition}
                          onMenu={(x, y) => setMenu({ row: entry.row, x, y })}
                        />
                      ) : (
                        <FlatRow
                          entry={entry}
                          isCurrent={item.index === currentPosition}
                          onMenu={(x, y) => setMenu({ row: entry.row, x, y })}
                        />
                      )}
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
            </>
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

/**
 * Side-by-side: one row carrying both sides, aligned by JSONPath.
 *
 * One row per path rather than two scrolling columns — the same reason the text
 * view pairs its rows: the sides cannot drift out of alignment and there is no
 * scroll to synchronise. A key that exists on only one side leaves the other
 * striped, which reads as "nothing here" rather than "empty value".
 */
function SplitRow({
  entry,
  isCurrent,
  onMenu,
}: {
  entry: JsonDisplayRow;
  isCurrent: boolean;
  onMenu: (x: number, y: number) => void;
}) {
  const { row } = entry;
  const before = beforeText(row);
  const after = afterText(row);

  return (
    <div
      className="dd-jsplit"
      data-state={row.state}
      data-current={isCurrent ? 'true' : 'false'}
      data-path={row.path}
      role="row"
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => menuKey(event, onMenu)}
    >
      <SplitSide row={row} side="before" text={before} absent={before === undefined} />
      <SplitSide row={row} side="after" text={after} absent={after === undefined} />
    </div>
  );
}

function SplitSide({
  row,
  side,
  text,
  absent,
}: {
  row: JsonRow;
  side: 'before' | 'after';
  text: string | undefined;
  absent: boolean;
}) {
  return (
    <div className="dd-jside" data-side={side} data-kind={absent ? 'nil' : row.state}>
      <span className="dd-jgutter" aria-hidden="true" />
      {!absent && (
        <>
          <span className="dd-jpath" title={row.path}>
            {row.path}
          </span>
          <span className="dd-jval" data-tone={toneFor(row, side)}>
            {text}
          </span>
          {/* The note names the transition (`number → string`), so it belongs
              with the value that arrived — and the marker rides the same side,
              one per row, at the row's end. */}
          {side === 'after' && row.note !== undefined && (
            <span className="dd-jnote">{row.note}</span>
          )}
          {side === 'after' && (
            <span className="dd-jmark" aria-hidden="true">
              {markFor(row)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Unified and inline: one column, addressed by path.
 *
 * Unified splits a modification into `− before` and `+ after` (the `half` the
 * display model set); inline keeps both on one row as `before → after`, which is
 * what the tree does without the indentation.
 */
function FlatRow({
  entry,
  isCurrent,
  onMenu,
}: {
  entry: JsonDisplayRow;
  isCurrent: boolean;
  onMenu: (x: number, y: number) => void;
}) {
  const { row, half } = entry;
  const split = half !== undefined;
  const state = split ? (half === 'before' ? 'del' : 'add') : row.state;

  return (
    <div
      className="dd-jflat"
      data-state={state}
      data-current={isCurrent ? 'true' : 'false'}
      data-path={row.path}
      data-half={half ?? 'both'}
      role="row"
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => menuKey(event, onMenu)}
    >
      <span className="dd-jgutter" aria-hidden="true" />
      <span className="dd-jmark" aria-hidden="true">
        {split ? (half === 'before' ? '−' : '+') : markFor(row)}
      </span>
      <span className="dd-jpath" title={row.path}>
        {row.path}
      </span>

      {half === 'before' ? (
        <span className="dd-jval" data-tone="old">
          {beforeText(row)}
        </span>
      ) : half === 'after' ? (
        <span className="dd-jval" data-tone="new">
          {afterText(row)}
        </span>
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
      ) : (
        <span
          className="dd-jval"
          data-tone={toneFor(row, row.state === 'del' ? 'before' : 'after')}
        >
          {row.state === 'del' ? beforeText(row) : afterText(row)}
        </span>
      )}

      {/* A type change names its transition; on a split row only the `+` half
          carries it, or the note would appear twice for one change. */}
      {row.note !== undefined && half !== 'before' && <span className="dd-jnote">{row.note}</span>}
    </div>
  );
}

/**
 * Raw: the two documents as they arrived, not a diff.
 *
 * One scroll container holding two columns, so there is a single scrollbar and
 * nothing to keep in sync. The lines are deliberately *not* paired — pairing
 * them would be a line diff of reformatted JSON, the comparison this engine
 * exists to avoid.
 */
function RawPanes({
  a,
  b,
}: {
  a: { name: string; text?: string; large?: boolean } | null;
  b: { name: string; text?: string; large?: boolean } | null;
}) {
  return (
    <div className="dd-jraw" data-testid="json-raw">
      <RawPane side="before" input={a} />
      <RawPane side="after" input={b} />
    </div>
  );
}

function RawPane({
  side,
  input,
}: {
  side: 'before' | 'after';
  input: { name: string; text?: string; large?: boolean } | null;
}) {
  const text = input?.text;
  return (
    <div className="dd-jrawpane" data-side={side}>
      <div className="dd-jrawhd">{input?.name ?? '—'}</div>
      {text === undefined ? (
        <p className="dd-json-empty" data-testid={`json-raw-absent-${side}`}>
          {input?.large === true
            ? 'Too large to show inline — the engine read it from disk.'
            : 'This side has no text to show.'}
        </p>
      ) : (
        <pre className="dd-jrawtext">{text}</pre>
      )}
    </div>
  );
}

/** Shift+F10 / the context-menu key, for a row that has no button to click. */
function menuKey(
  event: ReactKeyboardEvent<HTMLDivElement>,
  onMenu: (x: number, y: number) => void,
): void {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    onMenu(box.left + 40, box.bottom);
  }
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
  const mark = markFor(row);

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
      onKeyDown={(event) => menuKey(event, onMenu)}
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
        <span className="dd-jnote">{containerText(row)}</span>
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
        <span className="dd-jnote">{containerText(row)}</span>
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
