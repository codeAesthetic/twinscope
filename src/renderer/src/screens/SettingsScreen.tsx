import type { ReactNode } from 'react';
import { useState } from 'react';
import { Kbd, Seg, Switch } from '../components/primitives';
import { SHORTCUTS } from '../lib/mockData';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';

/**
 * Settings, with progressive disclosure (MD §33) — four short groups rather
 * than every option at once.
 *
 * Static for HOME-4 except the theme control, which is genuinely live: the
 * provider already exists, and a theme picker that does nothing is a worse lie
 * than an obviously unfinished screen. The rest lands with its feature.
 */
export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const [ignoreKeyOrder, setIgnoreKeyOrder] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  const [storeContents, setStoreContents] = useState(false);
  const [checkUpdates, setCheckUpdates] = useState(true);

  return (
    <div className="dd-settings" data-testid="screen-settings">
      <h2>Appearance</h2>
      <div className="dd-card">
        <Row title="Theme" desc="Dark-mode first. Follows the system when you ask it to.">
          <Seg<ThemePreference>
            label="Theme"
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Row>
        <Row title="Density" desc="Row height for diff and tree views.">
          <button type="button" className="dd-selectish" title="Wired up in MVP-11">
            Compact
          </button>
        </Row>
        <Row title="Editor font" desc="Used in all code and data views.">
          <button type="button" className="dd-selectish" title="Wired up in MVP-4">
            SF Mono · 12px
          </button>
        </Row>
      </div>

      <h2>Comparison defaults</h2>
      <div className="dd-card">
        <Row title="Ignore whitespace" desc="Applies to the text and code engines.">
          <Switch
            checked={ignoreWhitespace}
            onChange={setIgnoreWhitespace}
            label="Ignore whitespace"
          />
        </Row>
        <Row
          title="Collapse unchanged sections"
          desc="Keeps 3 lines of context around each change."
        >
          <Switch
            checked={collapseUnchanged}
            onChange={setCollapseUnchanged}
            label="Collapse unchanged sections"
          />
        </Row>
        <Row title="Ignore JSON key order" desc="Recommended for API responses.">
          <Switch checked={ignoreKeyOrder} onChange={setIgnoreKeyOrder} label="Ignore key order" />
        </Row>
      </div>

      <h2>Privacy</h2>
      <div className="dd-card">
        <Row title="Telemetry" desc="Off by default and opt-in only. Nothing leaves this machine.">
          <Switch checked={telemetry} onChange={setTelemetry} label="Telemetry" />
        </Row>
        <Row
          title="Store file contents in history"
          desc="Off — history keeps paths, types and settings only."
        >
          <Switch
            checked={storeContents}
            onChange={setStoreContents}
            label="Store file contents in history"
          />
        </Row>
        <Row title="Check for updates" desc="Signed releases, verified before install.">
          <Switch checked={checkUpdates} onChange={setCheckUpdates} label="Check for updates" />
        </Row>
      </div>

      <h2>Shortcuts</h2>
      <div className="dd-card">
        <div className="dd-shortcuts" data-testid="shortcuts-grid">
          {SHORTCUTS.map((shortcut) => (
            <div className="dd-scrow" key={shortcut.label}>
              <span>{shortcut.label}</span>
              <span className="dd-scrow-keys">
                <Kbd>{shortcut.keys}</Kbd>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="dd-srow">
      <div className="dd-srow-text">
        <div className="dd-srow-title">{title}</div>
        <div className="dd-srow-desc">{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
