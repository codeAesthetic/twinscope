import { useEffect, useMemo, useState } from 'react';
import { NormalizeControls } from '../../components/compare/NormalizeControls';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import {
  DEFAULT_WEB_OPTIONS,
  type WebDiffData,
  type WebDiffOptions,
  type WebSection,
} from '../../../../engines/web';
import type { EngineViewProps } from './engineViews';

/**
 * Page comparison (v0.3.2) — four sections, switched rather than stacked.
 *
 * A page differs in four unrelated ways, and the reader almost always wants one of
 * them at a time: "did the markup move", "did the styling change", "what does it load
 * now", "is it still readable by a screen reader". The section switcher carries its
 * counts so choosing one is not a guess.
 */
const SECTIONS: Array<{ value: WebSection; label: string }> = [
  { value: 'structure', label: 'Structure' },
  { value: 'style', label: 'Style' },
  { value: 'assets', label: 'Assets' },
  { value: 'a11y', label: 'Accessibility' },
];

export default function WebView({ result }: EngineViewProps) {
  const data = result.data as WebDiffData;
  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options: WebDiffOptions = { ...DEFAULT_WEB_OPTIONS, ...storeOptions };

  // Open on the section that has something to say, rather than always on Structure.
  const [section, setSection] = useState<WebSection>(() => {
    const first = SECTIONS.find((candidate) => data.counts[candidate.value] > 0);
    return first?.value ?? 'structure';
  });

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  useEffect(() => {
    enableSearch('Filter by node, selector or URL…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      data.rows.filter((row) => {
        if (row.section !== section) return false;
        if (needle === '') return true;
        return `${row.key} ${row.detail}`.toLowerCase().includes(needle);
      }),
    [data.rows, section, needle],
  );

  useEffect(() => {
    register(rows.length, (index) => {
      const key = rows[index]?.key;
      if (key === undefined) return;
      document
        .querySelector(`[data-webkey="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return clearNav;
  }, [register, clearNav, rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Section"
          value={section}
          onChange={(next) => setSection(next)}
          options={SECTIONS.map((candidate) => ({
            value: candidate.value,
            label: `${candidate.label} (${data.counts[candidate.value]})`,
          }))}
        />
        <Toggle
          pressed={options.compareClasses}
          onChange={(next) => void setOptions({ compareClasses: next })}
        >
          Compare classes
        </Toggle>
        <Toggle
          pressed={options.ignoreAssetQuery}
          onChange={(next) => void setOptions({ ignoreAssetQuery: next })}
        >
          Ignore asset query
        </Toggle>
      </ToolbarSlot>

      <div className="dd-diffsplit">
        <div className="dd-envscroll" data-testid="web-view" data-section={section}>
          <div className="dd-webheads">
            <span>
              <b>{data.pages.before.title || '(no title)'}</b> — {data.pages.before.nodes} nodes,{' '}
              {data.pages.before.assets} assets
            </span>
            <span>
              <b>{data.pages.after.title || '(no title)'}</b> — {data.pages.after.nodes} nodes,{' '}
              {data.pages.after.assets} assets
            </span>
          </div>

          <table className="dd-envtable">
            <thead>
              <tr>
                <th>
                  {section === 'style' ? 'Selector' : section === 'assets' ? 'Asset' : 'Node'}
                </th>
                <th>Before</th>
                <th>After</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.key}-${index}`}
                  data-webkey={row.key}
                  data-state={row.state}
                  data-concern={row.concern === true ? 'true' : 'false'}
                >
                  <td className="dd-envkey">
                    {row.key}
                    {row.concern === true && <span className="dd-envsecret">a11y</span>}
                  </td>
                  <td className="dd-envold">{row.before ?? '—'}</td>
                  <td className="dd-envnew">{row.after ?? '—'}</td>
                  <td className="dd-envstate">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <p className="dd-empty" data-testid="web-empty">
              {data.counts[section] === 0
                ? `No differences in this section.`
                : 'Nothing matches that filter.'}
            </p>
          )}

          {/* What this comparison did not do, where the reader is looking at what it
              did. "No visual differences" is not something it looked for. */}
          <p className="dd-webnote" data-testid="web-scope">
            Two saved pages: markup, inline styles, referenced assets and accessibility facts.{' '}
            <Chip>nothing fetched</Chip> <Chip>nothing rendered</Chip> <Chip>no screenshot</Chip>
          </p>
        </div>

        <NormalizeControls
          suppressed={result.summary.suppressed ?? 0}
          notes={result.normalizationNotes}
        />
      </div>
    </div>
  );
}
