import { useEffect, useMemo, useState } from 'react';
import { NormalizeControls } from '../../components/compare/NormalizeControls';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { DEFAULT_API_OPTIONS, type ApiDiffData, type ApiEntryRow } from '../../../../engines/api';
import type { EngineViewProps } from './engineViews';

/**
 * The API comparison view (v0.3.1).
 *
 * Not a tree and not a table: an API diff is read **verdict first**. The engine
 * sorts breaking findings to the top and this view keeps them there, because the
 * whole point of comparing two contracts is the answer to "does this break anyone",
 * and a reader who has to hunt for it will not.
 *
 * Entries collapse. A HAR pair can hold a hundred requests, most of which did not
 * change, and expanding all of them by default would bury the four that did.
 */
type Filter = 'all' | 'breaking' | 'changed';

export default function ApiView({ result }: EngineViewProps) {
  const data = result.data as ApiDiffData;
  const [filter, setFilter] = useState<Filter>(data.mode === 'contract' ? 'all' : 'changed');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options = { ...DEFAULT_API_OPTIONS, ...storeOptions };

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  useEffect(() => {
    enableSearch('Filter by path or field…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const needle = query.trim().toLowerCase();

  const findings = useMemo(() => {
    return data.findings.filter((finding) => {
      if (filter === 'breaking' && finding.verdict !== 'breaking') return false;
      if (needle === '') return true;
      return `${finding.where} ${finding.detail} ${finding.rule}`.toLowerCase().includes(needle);
    });
  }, [data.findings, filter, needle]);

  const entries = useMemo(() => {
    return data.entries.filter((entry) => {
      if (filter === 'breaking' && entry.verdict !== 'breaking') return false;
      if (filter === 'changed' && entry.verdict === 'unchanged') return false;
      if (needle === '') return true;
      return entry.key.toLowerCase().includes(needle);
    });
  }, [data.entries, filter, needle]);

  // Change navigation walks whatever this mode has to navigate: findings for a
  // contract pair, entries for a capture. One index, so ⌥↑/⌥↓ and the strip agree.
  const navigable = data.mode === 'contract' ? findings.length : entries.length;
  useEffect(() => {
    register(navigable, (index) => {
      const id =
        data.mode === 'contract' ? `finding-${index}` : `entry-${entries[index]?.key ?? ''}`;
      document.querySelector(`[data-nav="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
    });
    return clearNav;
  }, [register, clearNav, navigable, data.mode, entries]);

  const breaking = data.findings.filter((finding) => finding.verdict === 'breaking').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Show"
          value={filter}
          onChange={(next) => setFilter(next)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'breaking', label: `Breaking${breaking > 0 ? ` (${breaking})` : ''}` },
            { value: 'changed', label: 'Changed only' },
          ]}
        />
        {data.mode !== 'contract' && (
          <Toggle
            pressed={options.compareRequests === true}
            onChange={(next) => void setOptions({ compareRequests: next })}
          >
            Compare request bodies
          </Toggle>
        )}
        <Button
          size="sm"
          data-testid="api-expand-all"
          onClick={() =>
            setOpen((previous) =>
              previous.size > 0 ? new Set() : new Set(entries.map((entry) => entry.key)),
            )
          }
        >
          {open.size > 0 ? 'Collapse all' : 'Expand all'}
        </Button>
      </ToolbarSlot>

      <div className="dd-diffsplit">
        <div className="dd-apiscroll" data-testid="api-view">
          {data.mode === 'contract' && (
            <>
              <div className="dd-apiverdict" data-testid="api-verdict" data-breaking={breaking > 0}>
                {breaking > 0
                  ? `${breaking} breaking change${breaking === 1 ? '' : 's'} — consumers of this API will fail.`
                  : 'No breaking changes. Every difference below is backwards compatible.'}
                {data.versions !== undefined && (
                  <Chip variant="info">
                    OpenAPI {data.versions.before} → {data.versions.after}
                  </Chip>
                )}
              </div>

              {findings.length === 0 && (
                <p className="dd-empty" data-testid="api-empty">
                  Nothing matches that filter.
                </p>
              )}

              <ul className="dd-apifindings">
                {findings.map((finding, index) => (
                  <li
                    key={`${finding.rule}-${finding.where}-${index}`}
                    data-nav={`finding-${index}`}
                    data-verdict={finding.verdict}
                    data-testid={`api-finding-${index}`}
                  >
                    <Chip variant={finding.verdict === 'breaking' ? 'del' : 'add'}>
                      {finding.verdict}
                    </Chip>
                    <span className="dd-apiwhere">{finding.where}</span>
                    <span className="dd-apidetail">{finding.detail}</span>
                    {/* The rule is on screen, not in a tooltip: a verdict nobody can
                        audit is a guess with a badge on it. */}
                    <code className="dd-apirule">{finding.rule}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {data.mode !== 'contract' && (
            <>
              {entries.length === 0 && (
                <p className="dd-empty" data-testid="api-empty">
                  {data.entries.length === 0
                    ? 'No entries in either capture.'
                    : 'Nothing matches that filter — try All.'}
                </p>
              )}
              {entries.map((entry) => (
                <Entry
                  key={entry.key}
                  entry={entry}
                  open={open.has(entry.key)}
                  onToggle={() =>
                    setOpen((previous) => {
                      const next = new Set(previous);
                      if (next.has(entry.key)) next.delete(entry.key);
                      else next.add(entry.key);
                      return next;
                    })
                  }
                />
              ))}
            </>
          )}
        </div>

        <NormalizeControls
          suppressed={result.summary.suppressed ?? 0}
          notes={result.normalizationNotes}
        />
      </div>
    </div>
  );
}

function Entry({
  entry,
  open,
  onToggle,
}: {
  entry: ApiEntryRow;
  open: boolean;
  onToggle: () => void;
}) {
  const headerCount =
    entry.headers.added.length + entry.headers.removed.length + entry.headers.changed.length;

  return (
    <section
      className="dd-apientry"
      data-verdict={entry.verdict}
      data-nav={`entry-${entry.key}`}
      data-testid={`api-entry-${entry.key}`}
    >
      <button type="button" className="dd-apihead" onClick={onToggle} aria-expanded={open}>
        <span className="dd-apitwisty" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="dd-apimethod" data-method={entry.method}>
          {entry.method}
        </span>
        <span className="dd-apipath">{entry.path}</span>
        <span className="dd-apichips">
          {entry.presence !== 'both' && (
            <Chip variant={entry.presence === 'before-only' ? 'del' : 'add'}>
              {entry.presence === 'before-only' ? 'gone' : 'new'}
            </Chip>
          )}
          {entry.status.before !== entry.status.after && (
            <Chip variant="mod">
              {entry.status.before ?? '–'} → {entry.status.after ?? '–'}
            </Chip>
          )}
          {headerCount > 0 && <Chip variant="info">{headerCount} headers</Chip>}
          {entry.body !== null &&
            entry.body.added + entry.body.removed + entry.body.changed > 0 && (
              <Chip variant="mod">
                {entry.body.added + entry.body.removed + entry.body.changed} body
              </Chip>
            )}
          {entry.verdict === 'unchanged' && <Chip>same</Chip>}
        </span>
      </button>

      {open && (
        <div className="dd-apibody">
          {entry.bodyNote !== undefined && <p className="dd-apinote">{entry.bodyNote}</p>}

          {headerCount > 0 && (
            <table className="dd-apitable">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...entry.headers.changed.map((header) => ['chg', header] as const),
                  ...entry.headers.removed.map((header) => ['del', header] as const),
                  ...entry.headers.added.map((header) => ['add', header] as const),
                ].map(([state, header]) => (
                  <tr key={`${state}-${header.name}`} data-state={state}>
                    <td>{header.name}</td>
                    <td className="dd-apiold">{header.before ?? '—'}</td>
                    <td className="dd-apinew">{header.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {entry.body !== null && (
            <table className="dd-apitable" data-testid={`api-body-${entry.key}`}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {entry.body.rows
                  .filter((row) => row.state !== 'same' && row.container === undefined)
                  .slice(0, 200)
                  .map((row) => (
                    <tr key={row.path} data-state={row.state}>
                      <td>{row.path}</td>
                      <td className="dd-apiold">{row.a ?? '—'}</td>
                      <td className="dd-apinew">{row.b ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {entry.headers.suppressed > 0 && (
            <p className="dd-apinote">
              {entry.headers.suppressed} volatile header
              {entry.headers.suppressed === 1 ? '' : 's'} ignored on this entry.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
