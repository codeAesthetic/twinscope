import { useState } from 'react';
import { ChangeNav, SummaryStrip } from '../components/compare/SummaryStrip';
import { Button, Chip, SearchInput, Seg, Toggle } from '../components/primitives';

type ViewMode = 'side' | 'unified' | 'inline';

/**
 * The comparison workspace — the shared chassis every engine view plugs into
 * (MD §11): toolbar, summary strip, change navigation, then the result area.
 *
 * HOME-4 builds the chassis with static numbers and an empty result area. MVP-3
 * wires it to real jobs and MVP-4..7 fill the result area per engine, so the
 * layout here is deliberately engine-agnostic.
 *
 * Not in the sidebar: you arrive here by running a comparison. Reachable at
 * #workspace while it has nothing to show.
 */
export function WorkspaceScreen() {
  const [mode, setMode] = useState<ViewMode>('side');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="screen-workspace"
    >
      <div className="dd-toolbar" data-testid="workspace-toolbar">
        <Chip variant="acc">Structural JSON diff</Chip>
        <Seg
          label="Diff view mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'side', label: 'Side-by-side' },
            { value: 'unified', label: 'Unified' },
            { value: 'inline', label: 'Inline' },
          ]}
        />
        <Toggle pressed={ignoreWhitespace} onChange={setIgnoreWhitespace}>
          Ignore whitespace
        </Toggle>
        <Toggle pressed={collapseUnchanged} onChange={setCollapseUnchanged}>
          Collapse unchanged
        </Toggle>
        <span className="dd-spacer" />
        <SearchInput placeholder="Search in diff…" hint="⌘F" />
        <Button title="Wired up in MVP-9">Export ▾</Button>
      </div>

      <SummaryStrip
        counts={{ added: 8, removed: 5, modified: 11 }}
        extras={<Chip variant="info">7 files</Chip>}
        navigation={<ChangeNav index={3} total={24} />}
        right={<Chip>users-v2.3.json ↔ users-v2.4.json</Chip>}
      />

      <div className="dd-comparison-area">
        <div>
          <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>
            Drop two inputs to start
          </p>
          <p style={{ margin: '8px 0 0', color: 'var(--tx-3)', fontSize: 12.5 }}>
            Engine views fill this area from MVP-4 onward.
          </p>
        </div>
      </div>
    </div>
  );
}
