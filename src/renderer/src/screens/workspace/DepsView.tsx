import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { DEFAULT_DEPS_OPTIONS } from '../../../../engines/deps';
import type { DepRow, DepsDiffData, DepsDiffOptions } from '../../../../engines/deps';
import type { EngineViewProps } from './engineViews';

type Filter = 'all' | 'add' | 'del' | 'mod' | 'risk';

const ROW_HEIGHT = 28;

const KIND_LABEL: Record<DepRow['kind'], string> = {
  prod: 'dependency',
  dev: 'dev',
  peer: 'peer',
  optional: 'optional',
};

/**
 * The dependency comparison (v0.2.10).
 *
 * A compact list rather than a tree, because the useful reading of two manifests is
 * a *table of packages* — name, where it moved, how far. Virtualised because a pair
 * of lockfiles has thousands of transitive rows.
 *
 * `risk` is the filter worth having: a major bump, a downgrade or a licence change
 * are the three things anyone reviewing a dependency update is actually looking for.
 */
export default function DepsView({ result }: EngineViewProps) {
  const data = result.data as DepsDiffData;
  const [filter, setFilter] = useState<Filter>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);

  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options = useMemo<DepsDiffOptions>(
    () => ({ ...DEFAULT_DEPS_OPTIONS, ...(storeOptions as Partial<DepsDiffOptions>) }),
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
    enableSearch('Filter by package name…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (!showUnchanged && row.status === 'same') return false;
      if (filter === 'risk' && !isRisky(row)) return false;
      if (filter !== 'all' && filter !== 'risk' && row.status !== filter) return false;
      return needle === '' || row.name.toLowerCase().includes(needle);
    });
  }, [data.rows, filter, query, showUnchanged]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Dependency filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'add', label: 'Added' },
            { value: 'del', label: 'Removed' },
            { value: 'mod', label: 'Changed' },
            { value: 'risk', label: 'Needs a look' },
          ]}
        />
        <Toggle pressed={showUnchanged} onChange={setShowUnchanged}>
          Show unchanged
        </Toggle>
        {/* These two re-run the engine: what counts as a dependency is part of the
            comparison, not of the presentation. */}
        <Toggle
          pressed={options.includeDev}
          onChange={(next) => void setOptions({ includeDev: next })}
        >
          Dev dependencies
        </Toggle>
        {data.resolved && (
          <Toggle
            pressed={options.includeTransitive}
            onChange={(next) => void setOptions({ includeTransitive: next })}
          >
            Transitive
          </Toggle>
        )}
      </ToolbarSlot>

      <div className="dd-depswrap" data-testid="deps-view">
        <div className="dd-depsmeta">
          <b>{data.source.before}</b>
          <span aria-hidden="true">→</span>
          <b>{data.source.after}</b>
          {data.resolved ? (
            <Chip variant="acc" data-testid="deps-resolved">
              {data.transitive.before} → {data.transitive.after} packages resolved
            </Chip>
          ) : (
            <Chip variant="info" data-testid="deps-declared">
              declared ranges only
            </Chip>
          )}
        </div>

        {/* Rule 3: what this pair *cannot* show is as important as what it does. */}
        {result.normalizationNotes.length > 0 && (
          <ul className="dd-depsnotes" data-testid="deps-notes">
            {result.normalizationNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        <div className="dd-depsscroll" ref={scrollRef}>
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
            <p className="dd-deps-empty" data-testid="deps-empty">
              {data.rows.length === 0
                ? 'Neither side declares any dependencies.'
                : 'No dependencies match this filter.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** A major bump, a downgrade, or a licence change — the three worth reviewing. */
function isRisky(row: DepRow): boolean {
  if (row.downgrade === true) return true;
  if (row.bump?.startsWith('major') === true) return true;
  return (
    row.licenseBefore !== undefined &&
    row.licenseAfter !== undefined &&
    row.licenseBefore !== row.licenseAfter
  );
}

function Row({ row, isCurrent }: { row: DepRow; isCurrent: boolean }) {
  const licenceChanged =
    row.licenseBefore !== undefined &&
    row.licenseAfter !== undefined &&
    row.licenseBefore !== row.licenseAfter;

  return (
    <div
      className="dd-depsrow"
      role="row"
      data-status={row.status}
      data-name={row.name}
      data-current={isCurrent ? 'true' : 'false'}
      data-transitive={row.transitive === true ? 'true' : 'false'}
      data-risk={isRisky(row) ? 'true' : 'false'}
    >
      <span className="dd-depsstatus" aria-hidden="true">
        {STATUS_GLYPH[row.status]}
      </span>
      <span className="dd-depsname">{row.name}</span>
      <span className="dd-depskind">
        {row.transitive === true ? 'transitive' : KIND_LABEL[row.kind]}
      </span>

      <span className="dd-depsversions">
        {row.before !== undefined && <span className="dd-depsbefore">{row.before}</span>}
        {row.before !== undefined && row.after !== undefined && <span aria-hidden="true">→</span>}
        {row.after !== undefined && <span className="dd-depsafter">{row.after}</span>}
      </span>

      {row.bump !== undefined && (
        <span
          className="dd-depsbump"
          data-bump={row.bump.replace(' ↓', '')}
          data-down={row.downgrade === true ? 'true' : 'false'}
          data-testid={`deps-bump-${row.name}`}
        >
          {row.bump}
        </span>
      )}

      {licenceChanged && (
        <span className="dd-depslicence" data-testid={`deps-licence-${row.name}`}>
          {row.licenseBefore} → {row.licenseAfter}
        </span>
      )}
    </div>
  );
}

const STATUS_GLYPH: Record<DepRow['status'], string> = {
  add: '＋',
  del: '✕',
  mod: '●',
  same: '·',
};
