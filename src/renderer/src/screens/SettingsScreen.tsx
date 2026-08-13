import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Kbd, Seg, Switch } from '../components/primitives';
import { combosFor, SHORTCUTS } from '../lib/shortcuts';
import { useSettingsStore } from '../stores/settings';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';

/**
 * Settings, with progressive disclosure (MD §33) — four short groups rather
 * than every option at once.
 *
 * The comparison defaults are real: they persist to main and seed every new
 * comparison (see `stores/settings.ts`). The two privacy switches are
 * deliberately fixed — TwinScope has no telemetry to turn on, and history stores
 * no file contents to opt into. They are shown as facts, not as controls that
 * pretend to do something.
 */
export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const preferences = useSettingsStore((state) => state.preferences);
  const load = useSettingsStore((state) => state.load);
  const setEngineDefault = useSettingsStore((state) => state.setEngineDefault);

  useEffect(() => {
    void load();
  }, [load]);

  const textDefaults = preferences.engineDefaults['text'] ?? {};
  const jsonDefaults = preferences.engineDefaults['json'] ?? {};
  const ignoreWhitespace = textDefaults['ignoreWhitespace'] !== false;
  const collapseUnchanged = textDefaults['collapseUnchanged'] !== false;
  const ignoreKeyOrder = jsonDefaults['ignoreKeyOrder'] !== false;

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
            onChange={(next) => void setEngineDefault('text', { ignoreWhitespace: next })}
            label="Ignore whitespace"
          />
        </Row>
        <Row
          title="Collapse unchanged sections"
          desc="Keeps 3 lines of context around each change."
        >
          <Switch
            checked={collapseUnchanged}
            onChange={(next) => void setEngineDefault('text', { collapseUnchanged: next })}
            label="Collapse unchanged sections"
          />
        </Row>
        <Row title="Ignore JSON key order" desc="Recommended for API responses.">
          <Switch
            checked={ignoreKeyOrder}
            onChange={(next) => void setEngineDefault('json', { ignoreKeyOrder: next })}
            label="Ignore key order"
          />
        </Row>
      </div>

      <h2>Privacy</h2>
      <div className="dd-card">
        <Row title="Telemetry" desc="There is none. TwinScope makes no network calls at all.">
          <Switch checked={false} onChange={() => undefined} label="Telemetry" disabled />
        </Row>
        <Row
          title="Store file contents in history"
          desc="Off — history keeps paths, types and settings only."
        >
          <Switch
            checked={false}
            onChange={() => undefined}
            label="Store file contents in history"
            disabled
          />
        </Row>
        {/* The preference exists and defaulted to ON, describing "signed releases,
            verified before install" — two claims that were both false: nothing
            checked anything, and the app is unsigned by decision. Shown off and
            disabled until the owner decides whether TwinScope may make a network
            call at all (plan v0.2.13). Saying nothing here would be worse: the
            switch was already on screen promising something. */}
        <Row title="Check for updates" desc="Not implemented — TwinScope makes no network calls.">
          <Switch checked={false} onChange={() => undefined} label="Check for updates" disabled />
        </Row>
      </div>

      <h2>Shortcuts</h2>
      <div className="dd-card">
        {/* Generated from the same registry that binds the keys, so this grid
            cannot describe a shortcut the app does not have. */}
        <div className="dd-shortcuts" data-testid="shortcuts-grid">
          {SHORTCUTS.map((shortcut) => (
            <div className="dd-scrow" key={shortcut.id}>
              <span>{shortcut.label}</span>
              <span className="dd-scrow-keys">
                {/* Every binding, not just the primary — a grid that lists one
                    key while two work is the drift this table exists to stop. */}
                {combosFor(shortcut).map((combo) => (
                  <Kbd key={combo}>{combo}</Kbd>
                ))}
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
