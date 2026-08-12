import { useState } from 'react';
import {
  Button,
  Chip,
  FileTypeBadge,
  Kbd,
  SearchInput,
  Seg,
  Switch,
  Toggle,
} from '../components/primitives';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Dev-facing gallery of every primitive, for eyeballing against the mockup in
 * both themes. Reachable at #gallery; never linked from the product UI.
 */
export function Gallery() {
  const { theme, toggle } = useTheme();
  const [view, setView] = useState<'side' | 'unified' | 'inline'>('side');
  const [ignoreWs, setIgnoreWs] = useState(true);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [telemetry, setTelemetry] = useState(false);

  return (
    <div style={{ padding: 28, maxWidth: 900, margin: '0 auto' }} data-testid="gallery">
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
        <h1 style={{ fontSize: 18, fontWeight: 650, margin: 0, letterSpacing: '-0.02em' }}>
          Design system
        </h1>
        <Chip variant="acc">theme: {theme}</Chip>
        <div style={{ flex: 1 }} />
        <Button onClick={toggle} data-testid="theme-toggle">
          Toggle theme
        </Button>
      </header>

      <Section title="Chips">
        <Chip>default</Chip>
        <Chip variant="add">＋8 added</Chip>
        <Chip variant="del">－5 removed</Chip>
        <Chip variant="mod">～11 modified</Chip>
        <Chip variant="info">7 files</Chip>
        <Chip variant="acc">Structural JSON diff</Chip>
      </Section>

      <Section title="Buttons">
        <Button variant="primary">Compare</Button>
        <Button>Export</Button>
        <Button variant="ghost">Change engine…</Button>
        <Button size="sm">Copy changed lines</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Segmented control">
        <Seg
          label="Diff view mode"
          value={view}
          onChange={setView}
          options={[
            { value: 'side', label: 'Side-by-side' },
            { value: 'unified', label: 'Unified' },
            { value: 'inline', label: 'Inline' },
          ]}
        />
      </Section>

      <Section title="Toggles">
        <Toggle pressed={ignoreWs} onChange={setIgnoreWs}>
          Ignore whitespace
        </Toggle>
        <Toggle pressed={ignoreCase} onChange={setIgnoreCase}>
          Ignore case
        </Toggle>
      </Section>

      <Section title="Search & keys">
        <SearchInput placeholder="Search in diff…" hint="⌘F" defaultValue="timeout" />
        <Kbd>⌘K</Kbd>
        <Kbd>⌥↓</Kbd>
      </Section>

      <Section title="File types">
        <FileTypeBadge kind="json" />
        <FileTypeBadge kind="code" />
        <FileTypeBadge kind="image" />
        <FileTypeBadge kind="folder" />
        <FileTypeBadge kind="md" />
        <FileTypeBadge kind="text" />
      </Section>

      <Section title="Switch">
        <Switch checked={telemetry} onChange={setTelemetry} label="Telemetry" />
        <span style={{ color: 'var(--tx-2)' }}>Telemetry {telemetry ? 'on' : 'off'}</span>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2
        style={{
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--tx-3)',
          margin: '0 0 10px',
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {children}
      </div>
    </section>
  );
}
