import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import type { FolderDiffData, FolderRow, FolderSide } from '../../../../engines/folder/folderDiff';
import type { EngineViewProps } from './engineViews';

type Filter = 'all' | 'add' | 'del' | 'mod' | 'same';

const ROW_HEIGHT = 22;

/**
 * The folder comparison (MD §15): two aligned columns, one row per path.
 *
 * Aligned rows rather than two independent trees, for the same reason the text
 * diff pairs its lines — a file that exists on one side only has to line up with
 * a visible gap, or the eye cannot tell what happened.
 */
export default function FolderTreeView({ result }: EngineViewProps) {
  const data = result.data as FolderDiffData;
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const drillInto = useCompareStore((state) => state.drillInto);
  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    enableSearch('Filter by name or *.ts…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const matcher = useMemo(() => globMatcher(query), [query]);

  /**
   * Filtered rows. A directory survives when any of its children does, so
   * filtering never leaves a file floating without its folder.
   */
  const rows = useMemo(() => {
    const keep = data.rows.map((row) => {
      if (row.isDir) return false;
      if (filter !== 'all' && row.status !== filter) return false;
      return matcher(baseName(row.path));
    });

    for (let index = 0; index < data.rows.length; index += 1) {
      if (!keep[index]) continue;
      const path = (data.rows[index] as FolderRow).path;
      for (let above = index - 1; above >= 0; above -= 1) {
        const candidate = data.rows[above] as FolderRow;
        if (candidate.isDir && path.startsWith(`${candidate.path}/`)) keep[above] = true;
      }
    }

    return data.rows.filter((_, index) => keep[index]);
  }, [data.rows, filter, matcher]);

  const changeRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !row.isDir && row.status !== 'same'),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useEffect(() => {
    register(changeRows.length, (changeIndex) => {
      const target = changeRows[changeIndex];
      if (target !== undefined) virtualizer.scrollToIndex(target.index, { align: 'center' });
    });
    return clearNav;
  }, [register, clearNav, changeRows, virtualizer]);

  const currentIndex = current === -1 ? -1 : (changeRows[current]?.index ?? -1);

  /**
   * Opens one file pair in its own comparison. Only files present on both sides
   * can be drilled into — there is nothing to compare a deletion against.
   */
  const open = async (row: FolderRow): Promise<void> => {
    if (row.isDir || row.left.status === 'nil' || row.right.status === 'nil') return;
    setDrillError(null);
    try {
      const [a, b] = await Promise.all([
        window.twinscope.input.read('A', `${data.roots.before}/${row.path}`),
        window.twinscope.input.read('B', `${data.roots.after}/${row.path}`),
      ]);
      await drillInto(a, b);
    } catch (cause) {
      setDrillError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="File status filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'add', label: 'Added' },
            { value: 'del', label: 'Deleted' },
            { value: 'mod', label: 'Modified' },
            { value: 'same', label: 'Identical' },
          ]}
        />
      </ToolbarSlot>

      <div className="dd-foldwrap" data-testid="folder-tree">
        <div className="dd-fhead">
          <div>
            <b>{data.roots.before}</b>
            <Chip>{data.files.before} files</Chip>
          </div>
          <div>
            <b>{data.roots.after}</b>
            <Chip>{data.files.after} files</Chip>
          </div>
        </div>

        {drillError !== null && (
          <p className="dd-folder-error" role="alert" data-testid="drill-error">
            {drillError}
          </p>
        )}

        <div className="dd-foldscroll" ref={scrollRef}>
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
                    isCurrent={item.index === currentIndex}
                    isSelected={selected === row.path}
                    onSelect={() => setSelected(row.path)}
                    onOpen={() => void open(row)}
                  />
                </div>
              );
            })}
          </div>

          {rows.length === 0 && (
            <p className="dd-folder-empty" data-testid="folder-empty">
              No files match this filter.
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
  row: FolderRow;
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const openable = !row.isDir && row.left.status !== 'nil' && row.right.status !== 'nil';

  return (
    <div
      className="dd-frow"
      data-status={row.status}
      data-path={row.path}
      data-current={isCurrent ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      data-openable={openable ? 'true' : 'false'}
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
      <Cell side={row.left} depth={row.depth} note={row.note} />
      <Cell side={row.right} depth={row.depth} note={row.note} />
    </div>
  );
}

function Cell({ side, depth, note }: { side: FolderSide; depth: number; note?: string }) {
  return (
    <div className="dd-fcell" data-status={side.status}>
      <span className="dd-ftree" aria-hidden="true">
        {'│  '.repeat(depth)}
        {depth > 0 ? '├─ ' : ''}
      </span>
      <span className="dd-fstatus" aria-hidden="true">
        {STATUS_GLYPH[side.status]}
      </span>
      {side.status === 'nil' ? (
        <span className="dd-fname" data-empty="true">
          —
        </span>
      ) : (
        <span className="dd-fname">{side.name}</span>
      )}
      {/* The note belongs to the side that actually has the file — repeating it
          on the empty stripe reads as two separate events. */}
      {note !== undefined && side.status !== 'nil' && <span className="dd-fnote">↳ {note}</span>}
      {side.size !== undefined && <span className="dd-fsize">{formatSize(side.size)}</span>}
    </div>
  );
}

/** Status is never colour alone — every state has a glyph (MD §33 a11y). */
const STATUS_GLYPH: Record<FolderSide['status'], string> = {
  add: '＋',
  del: '✕',
  mod: '●',
  same: '·',
  error: '!',
  nil: '',
};

function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `*.ts` behaves like a shell glob; anything else is a plain substring, because
 * that is what typing a few letters into a filter box means.
 */
function globMatcher(query: string): (name: string) => boolean {
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
    return (name) => pattern.test(name);
  }

  const needle = trimmed.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}
