import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { languageOf } from '../../../../engines/detect';
import type { GitDiffData, GitFileRow, GitStatus } from '../../../../engines/git';
import type { InputPayload } from '../../../../shared/channels';
import type { EngineViewProps } from './engineViews';

type Filter = 'all' | 'add' | 'del' | 'mod' | 'rename';

const ROW_HEIGHT = 22;

/**
 * The changed-file list for a git comparison (v0.2.1).
 *
 * One column, not the folder view's two: a git diff has one path per change —
 * even a rename, where the old name is a note on the new row rather than a
 * stripe of its own. Aligning two columns would mean inventing gaps git never
 * reported.
 *
 * Drill-in is the interesting part. Neither side of a ref↔ref comparison exists
 * on disk, so it cannot go through `input.read` the way the folder view does;
 * it fetches two `git show` blobs and hands the text straight to the store.
 */
export default function GitDiffView({ result }: EngineViewProps) {
  const data = result.data as GitDiffData;
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const drillInto = useCompareStore((state) => state.drillInto);
  const options = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    enableSearch('Filter by path or *.ts…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const matcher = useMemo(() => globMatcher(query), [query]);

  const rows = useMemo(
    () =>
      data.rows.filter((row) => {
        if (filter === 'rename' && row.status !== 'rename' && row.status !== 'copy') return false;
        if (filter !== 'all' && filter !== 'rename' && row.status !== filter) return false;
        return matcher(row.path);
      }),
    [data.rows, filter, matcher],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Every row in a git diff is a change, so navigation walks the visible list.
  useEffect(() => {
    register(rows.length, (index) => virtualizer.scrollToIndex(index, { align: 'center' }));
    return clearNav;
  }, [register, clearNav, rows.length, virtualizer]);

  const ignoreWhitespace = options.ignoreWhitespace === true;
  const detectRenames = options.detectRenames !== false;

  /**
   * Opens one changed file as its own text comparison.
   *
   * A blob that does not exist at a ref comes back `null` — which is exactly what
   * an addition or a deletion looks like — and becomes the empty string, so the
   * text engine shows the whole file as added or removed.
   */
  const open = async (row: GitFileRow): Promise<void> => {
    if (row.binary) {
      setDrillError(`${row.path} is binary — git reports no line-level changes for it.`);
      return;
    }
    setDrillError(null);

    try {
      const [beforeText, afterText] = await Promise.all([
        window.twinscope.git.blob({
          repo: data.repo,
          ref: data.before.ref,
          path: row.oldPath ?? row.path,
        }),
        window.twinscope.git.blob({ repo: data.repo, ref: data.after.ref, path: row.path }),
      ]);

      if (beforeText === null && afterText === null) {
        setDrillError(`${row.path} could not be read at either ref.`);
        return;
      }

      await drillInto(
        blobInput('A', row.oldPath ?? row.path, data.before.label, beforeText ?? ''),
        blobInput('B', row.path, data.after.label, afterText ?? ''),
      );
    } catch (cause) {
      setDrillError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Change status filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'add', label: 'Added' },
            { value: 'del', label: 'Deleted' },
            { value: 'mod', label: 'Modified' },
            { value: 'rename', label: 'Renamed' },
          ]}
        />
        {/* Both re-run the engine rather than filtering the list: git decides
            what changed, so the counts have to come back from git (Rule 3). */}
        <Toggle
          pressed={detectRenames}
          onChange={(next) => void setOptions({ detectRenames: next })}
        >
          Detect renames
        </Toggle>
        <Toggle
          pressed={ignoreWhitespace}
          onChange={(next) => void setOptions({ ignoreWhitespace: next })}
        >
          Ignore whitespace
        </Toggle>
      </ToolbarSlot>

      <div className="dd-gitwrap" data-testid="git-diff">
        <div className="dd-githead">
          <b data-testid="git-before-label">{data.before.label}</b>
          <span aria-hidden="true">→</span>
          <b data-testid="git-after-label">{data.after.label}</b>
          <Chip>
            {data.rows.length} file{data.rows.length === 1 ? '' : 's'}
          </Chip>
          {data.partial && <Chip variant="mod">partial</Chip>}
        </div>

        {drillError !== null && (
          <p className="dd-git-error" role="alert" data-testid="git-drill-error">
            {drillError}
          </p>
        )}

        <div className="dd-gitscroll" ref={scrollRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
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
                  <Row
                    row={row}
                    isCurrent={item.index === current}
                    isSelected={selected === row.path}
                    onSelect={() => setSelected(row.path)}
                    onOpen={() => void open(row)}
                  />
                </div>
              );
            })}
          </div>

          {rows.length === 0 && (
            <p className="dd-git-empty" data-testid="git-empty">
              {data.rows.length === 0
                ? 'These two refs are identical.'
                : 'No files match this filter.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  row,
  isCurrent,
  isSelected,
  onSelect,
  onOpen,
}: {
  row: GitFileRow;
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="dd-gitrow"
      data-status={row.status}
      data-path={row.path}
      data-current={isCurrent ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      data-openable={row.binary ? 'false' : 'true'}
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect();
          onOpen();
        }
      }}
    >
      {/* Status is never colour alone — every state carries a glyph (MD §33). */}
      <span className="dd-gitstatus" aria-hidden="true">
        {STATUS_GLYPH[row.status]}
      </span>
      <span className="dd-gitpath">{row.path}</span>
      {row.oldPath !== undefined && (
        <span className="dd-gitfrom">
          ↳ from {row.oldPath}
          {row.score !== undefined ? ` (${row.score}%)` : ''}
        </span>
      )}
      <span className="dd-gitcounts">
        {row.binary ? (
          <span className="dd-gitbin">binary</span>
        ) : (
          <>
            <span className="dd-gitplus">＋{row.added}</span>
            <span className="dd-gitminus">－{row.removed}</span>
          </>
        )}
      </span>
    </div>
  );
}

const STATUS_GLYPH: Record<GitStatus, string> = {
  add: '＋',
  del: '✕',
  mod: '●',
  rename: '→',
  copy: '⧉',
  type: '⇄',
  unmerged: '!',
  unknown: '?',
};

/**
 * A blob as an input. The name is the path so the text view picks the right
 * grammar, and the ref goes in as the display label rather than the name — the
 * two sides of a rename have different paths and the header has to show both.
 */
function blobInput(side: 'A' | 'B', path: string, ref: string, text: string): InputPayload {
  const language = languageOf(path);
  return {
    side,
    kind: 'text',
    name: `${path} @ ${ref}`,
    size: text.length,
    text,
    ...(language !== undefined ? { lang: language } : {}),
  };
}

/** Same rule as the folder filter: `*.ts` globs, anything else is a substring. */
function globMatcher(query: string): (path: string) => boolean {
  const trimmed = query.trim();
  if (trimmed === '') return () => true;

  if (trimmed.includes('*') || trimmed.includes('?')) {
    const source = trimmed
      .split(/([*?])/)
      .map((part) => {
        if (part === '*') return '.*';
        if (part === '?') return '.';
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    const pattern = new RegExp(`^${source}$`, 'i');
    // A glob is matched against the basename, which is what `*.ts` means to a
    // reader; the substring form still searches the whole path.
    return (path) => pattern.test(path.split('/').pop() ?? path);
  }

  const needle = trimmed.toLowerCase();
  return (path) => path.toLowerCase().includes(needle);
}
