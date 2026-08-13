import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { DEFAULT_CSV_OPTIONS } from '../../../../engines/csv';
import type { CsvCell, CsvDiffData, CsvDiffOptions, CsvRow } from '../../../../engines/csv';
import type { EngineViewProps } from './engineViews';

type Filter = 'all' | 'add' | 'del' | 'mod' | 'same';

const ROW_HEIGHT = 26;
/** Wide enough for a short value, narrow enough that five columns still fit. */
const COLUMN_WIDTH = 180;
const GUTTER_WIDTH = 92;

/**
 * The table diff (v0.2.5).
 *
 * A grid rather than a tree, because the question a reader has about two CSVs is
 * "which cell changed" — and neither the JSON tree nor a line diff can answer it.
 *
 * One scroll container holds the sticky header and the virtualised body, so the
 * two cannot drift apart horizontally; the row-number gutter is `position: sticky`
 * inside it, which keeps "row 412" visible while scrolling right.
 */
export default function CsvTableView({ result }: EngineViewProps) {
  const data = result.data as CsvDiffData;
  const [filter, setFilter] = useState<Filter>('all');

  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options = useMemo<CsvDiffOptions>(
    () => ({ ...DEFAULT_CSV_OPTIONS, ...(storeOptions as Partial<CsvDiffOptions>) }),
    [storeOptions],
  );

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    enableSearch('Filter rows by any cell…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (needle === '') return true;
      // Searching the *values* rather than the rendered row: a hit on an old value
      // has to count too, or a changed cell becomes unfindable by its former text.
      return row.cells.some(
        (cell) =>
          cell.value.toLowerCase().includes(needle) ||
          (cell.was ?? '').toLowerCase().includes(needle),
      );
    });
  }, [data.rows, filter, query]);

  const changeRows = useMemo(
    () => rows.map((row, index) => ({ row, index })).filter(({ row }) => row.status !== 'same'),
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
  const width = GUTTER_WIDTH + data.columns.length * COLUMN_WIDTH;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Row status filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'add', label: 'Added' },
            { value: 'del', label: 'Removed' },
            { value: 'mod', label: 'Changed' },
            { value: 'same', label: 'Identical' },
          ]}
        />

        {/* The key column re-runs the engine rather than re-sorting the view:
            pairing is a property of the comparison, not of the presentation. */}
        <label>
          <span className="dd-sr-only">Pair rows on column</span>
          <select
            className="dd-selectish"
            data-testid="csv-key-column"
            value={options.keyColumn}
            onChange={(event) => void setOptions({ keyColumn: event.target.value })}
          >
            <option value="">Pair by position</option>
            {data.columns
              .filter((column) => column.status !== 'del')
              .map((column) => (
                <option key={column.name} value={column.name}>
                  Pair on {column.name}
                </option>
              ))}
          </select>
        </label>

        <Toggle
          pressed={options.hasHeader}
          onChange={(next) => void setOptions({ hasHeader: next })}
        >
          First row is a header
        </Toggle>
        <Toggle
          pressed={options.ignoreCase}
          onChange={(next) => void setOptions({ ignoreCase: next })}
        >
          Ignore case
        </Toggle>
      </ToolbarSlot>

      <div className="dd-csvwrap" data-testid="csv-table">
        <div className="dd-csvmeta">
          <Chip>
            {data.counts.before} → {data.counts.after} rows
          </Chip>
          <Chip>{data.columns.length} columns</Chip>
          {data.keyColumn !== null ? (
            <Chip variant="acc" data-testid="csv-key-chip">
              paired on {data.keyColumn}
            </Chip>
          ) : (
            <Chip variant="info">paired by position</Chip>
          )}
          {data.partial && <Chip variant="mod">partial</Chip>}
        </div>

        <div className="dd-csvscroll" ref={scrollRef}>
          <div className="dd-csvgrid" style={{ width }}>
            <div className="dd-csvhead" role="row">
              <div className="dd-csvgutter">row</div>
              {data.columns.map((column) => (
                <div
                  key={column.name}
                  className="dd-csvhcell"
                  style={{ width: COLUMN_WIDTH }}
                  data-status={column.status}
                  data-ignored={column.ignored ? 'true' : 'false'}
                  data-key={column.isKey ? 'true' : 'false'}
                  data-column={column.name}
                  title={column.name}
                >
                  {column.name}
                </div>
              ))}
            </div>

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
                    <Row row={row} isCurrent={item.index === currentIndex} />
                  </div>
                );
              })}
            </div>

            {rows.length === 0 && (
              <p className="dd-csv-empty" data-testid="csv-empty">
                No rows match this filter.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ row, isCurrent }: { row: CsvRow; isCurrent: boolean }) {
  return (
    <div
      className="dd-csvrow"
      role="row"
      data-status={row.status}
      data-key={row.key}
      data-current={isCurrent ? 'true' : 'false'}
    >
      <div className="dd-csvgutter">
        {/* Never colour alone — every status has a glyph (MD §33 a11y). */}
        <span className="dd-csvstatus" aria-hidden="true">
          {STATUS_GLYPH[row.status]}
        </span>
        <span>{row.before ?? '–'}</span>
        <span aria-hidden="true">→</span>
        <span>{row.after ?? '–'}</span>
      </div>
      {row.cells.map((cell, index) => (
        <Cell key={index} cell={cell} />
      ))}
    </div>
  );
}

function Cell({ cell }: { cell: CsvCell }) {
  return (
    <div className="dd-csvcell" style={{ width: COLUMN_WIDTH }} data-state={cell.state}>
      {cell.was !== undefined && (
        <span className="dd-csvwas" title={cell.was}>
          {cell.was === '' ? '∅' : cell.was}
        </span>
      )}
      <span className="dd-csvnow" title={cell.value}>
        {cell.value}
      </span>
    </div>
  );
}

const STATUS_GLYPH: Record<CsvRow['status'], string> = {
  add: '＋',
  del: '✕',
  mod: '●',
  same: '·',
};
