import { useEffect, useMemo, useState } from 'react';
import { NormalizeControls } from '../../components/compare/NormalizeControls';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import {
  DEFAULT_ENV_OPTIONS,
  SECRET_REASON_LABEL,
  type EnvDiffData,
  type EnvDiffOptions,
  type EnvRow,
} from '../../../../engines/env';
import type { EngineViewProps } from './engineViews';

/**
 * Config comparison (v0.3.7) — a two-column table of keys.
 *
 * The one thing this view must get right is that it **cannot unmask anything**. The
 * engine masks before the row model exists, so "Show secrets" is not a display
 * toggle: it re-runs the comparison with `revealSecrets`, exactly as the
 * normalisation toggles re-run it. That is what keeps the report, the clipboard and
 * the CLI honest — there is no path where the view holds a secret the export does
 * not.
 */
type Filter = 'changed' | 'all' | 'secrets';

const STATE_LABEL: Record<EnvRow['state'], string> = {
  changed: 'changed',
  emptied: 'emptied',
  filled: 'filled in',
  added: 'added',
  removed: 'removed',
  same: 'same',
};

export default function EnvView({ result }: EngineViewProps) {
  const data = result.data as EnvDiffData;
  const [filter, setFilter] = useState<Filter>('changed');
  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options: EnvDiffOptions = { ...DEFAULT_ENV_OPTIONS, ...storeOptions };

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  useEffect(() => {
    enableSearch('Filter keys…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    return data.rows.filter((row) => {
      if (filter === 'changed' && row.state === 'same') return false;
      if (filter === 'secrets' && !row.secret) return false;
      if (needle === '') return true;
      return row.key.toLowerCase().includes(needle);
    });
  }, [data.rows, filter, needle]);

  useEffect(() => {
    const changes = rows.filter((row) => row.state !== 'same');
    register(changes.length, (index) => {
      const key = changes[index]?.key;
      if (key === undefined) return;
      document
        .querySelector(`[data-envkey="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return clearNav;
  }, [register, clearNav, rows]);

  const copyKeys = async (): Promise<void> => {
    // Masked values by construction: this copies the rows as rendered, and the
    // rendering is what the engine produced.
    const text = rows
      .filter((row) => row.state !== 'same')
      .map((row) => `${row.state.padEnd(8)} ${row.key}  ${row.before ?? '—'} → ${row.after ?? '—'}`)
      .join('\n');
    await window.twinscope.clipboard.write(text);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Show"
          value={filter}
          onChange={(next) => setFilter(next)}
          options={[
            { value: 'changed', label: 'Changed' },
            { value: 'all', label: `All (${data.rows.length})` },
            { value: 'secrets', label: `Secrets (${data.secrets})` },
          ]}
        />
        {/* Not a display toggle: this re-runs the engine, because the engine is where
            masking happens. Off on every run, never remembered. */}
        <Toggle
          pressed={options.revealSecrets}
          onChange={(next) => void setOptions({ revealSecrets: next })}
        >
          Show secrets
        </Toggle>
        <Button size="sm" onClick={() => void copyKeys()} data-testid="env-copy">
          Copy changes
        </Button>
      </ToolbarSlot>

      <div className="dd-diffsplit">
        <div className="dd-envscroll" data-testid="env-view" data-kind={data.kind}>
          {options.revealSecrets && (
            <p className="dd-envwarn" data-testid="env-reveal-warning">
              Secrets are shown. This applies to this comparison only — and to anything you export
              or copy while it is on.
            </p>
          )}

          <table className="dd-envtable">
            <thead>
              <tr>
                <th>Key</th>
                <th>Before</th>
                <th>After</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-envkey={row.key} data-state={row.state}>
                  <td className="dd-envkey">
                    {row.key}
                    {row.secret && (
                      <span
                        className="dd-envsecret"
                        title={`Masked — ${SECRET_REASON_LABEL[row.secretReason]}`}
                        data-testid={`env-secret-${row.key}`}
                      >
                        secret
                      </span>
                    )}
                    {row.decoded === true && <span className="dd-envsecret">base64</span>}
                  </td>
                  <td className="dd-envold">{row.before ?? '—'}</td>
                  <td className="dd-envnew">{row.after ?? '—'}</td>
                  <td className="dd-envstate">{STATE_LABEL[row.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <p className="dd-empty" data-testid="env-empty">
              {data.rows.length === 0
                ? 'Neither file has any keys this engine could read.'
                : 'Nothing matches that filter.'}
            </p>
          )}
        </div>

        <div className="dd-normpanel" data-testid="env-options">
          <div className="dd-opthd">Keys</div>
          <IgnoreKeys
            keys={options.ignoreKeys}
            onChange={(next) => void setOptions({ ignoreKeys: next })}
          />
          <NormalizeControls
            suppressed={result.summary.suppressed ?? 0}
            notes={result.normalizationNotes}
          />
        </div>
      </div>
    </div>
  );
}

/** Globs whose keys are left out entirely — `*_AT`, `BUILD_*`. */
function IgnoreKeys({
  keys,
  onChange,
}: {
  keys: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div className="dd-normcustom">
      {keys.map((glob) => (
        <div key={glob} className="dd-normrule">
          <code>{glob}</code>
          <button
            type="button"
            aria-label={`Stop ignoring ${glob}`}
            data-testid={`env-unignore-${glob}`}
            onClick={() => onChange(keys.filter((candidate) => candidate !== glob))}
          >
            ✕
          </button>
        </div>
      ))}
      <input
        type="text"
        spellCheck={false}
        placeholder="ignore keys, e.g. BUILD_*"
        data-testid="env-ignore-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const glob = draft.trim();
          if (glob === '' || keys.includes(glob)) return;
          setDraft('');
          onChange([...keys, glob]);
        }}
      />
    </div>
  );
}
