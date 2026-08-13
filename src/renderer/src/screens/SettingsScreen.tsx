import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Button, Kbd, Seg, Switch } from '../components/primitives';
import { combosFor, SHORTCUTS } from '../lib/shortcuts';
import { describeUpdate } from '../lib/updateStatus';
import { useSettingsStore } from '../stores/settings';
import { useUpdateStore } from '../stores/update';
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
  const update = useSettingsStore((state) => state.update);
  const load = useSettingsStore((state) => state.load);
  const setEngineDefault = useSettingsStore((state) => state.setEngineDefault);

  const updateState = useUpdateStore((store) => store.state);
  const check = useUpdateStore((store) => store.check);
  const openRelease = useUpdateStore((store) => store.open);
  const loadUpdate = useUpdateStore((store) => store.load);

  // "checked 5 minutes ago" has to keep being true while the screen is open, so
  // the clock ticks rather than being read once during a render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void load();
    void loadUpdate();
  }, [load, loadUpdate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const checkUpdates = preferences.checkUpdates === true;
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
        <Row
          title="Telemetry"
          desc="There is none, and there is no analytics, crash reporting or account. The update check below is the only network call the app can make, and it is off unless you turn it on."
        >
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
        <Row
          title="Global Quick Compare"
          desc="⌘⇧D opens a small always-on-top panel from anywhere. Off by default — a global shortcut takes the combination from every other app."
        >
          <Switch
            checked={preferences.globalShortcut === true}
            onChange={(next) => void update({ globalShortcut: next })}
            label="Global Quick Compare"
          />
        </Row>
        <Row
          title="Clipboard watcher"
          desc="While the quick panel is open, offer new clipboard content. It offers — it never fills anything in by itself, and nothing is read until you accept."
        >
          <Switch
            checked={preferences.clipboardWatcher === true}
            onChange={(next) => void update({ clipboardWatcher: next })}
            label="Clipboard watcher"
          />
        </Row>
        {/* v0.2.13, and the only place the app admits to a network call. The
            description is the disclosure §7 bar 1 requires, so it says exactly
            what is contacted, when, and what is *not* done: no download, no
            install — the release page opens in the browser. Off by default. */}
        <Row
          title="Check for updates"
          // Describes the behaviour, not the current state: the switch beside it
          // and the status row below already say whether it is on.
          desc="The only network call TwinScope makes: it asks GitHub for the latest release number, once per launch. Off by default. Nothing is downloaded or installed — the release page opens in your browser."
        >
          <Switch
            checked={checkUpdates}
            onChange={(next) => void update({ checkUpdates: next })}
            label="Check for updates"
          />
        </Row>
        <Row title="Update status" desc={describeUpdate(updateState, now)}>
          <div className="dd-srow-actions">
            {/* Release notes appear *beside* Check now rather than replacing it:
                a found update is the moment you most want to re-check, once you
                have read what it contains. */}
            {updateState.status === 'available' ? (
              <Button
                variant="primary"
                size="sm"
                data-testid="update-release"
                onClick={() => void openRelease()}
              >
                Release notes
              </Button>
            ) : null}
            <Button
              size="sm"
              data-testid="update-check"
              // Disabled with the preference off, and that is not cosmetic: main
              // refuses a check either way, so an enabled button would be a
              // control that does nothing.
              disabled={!checkUpdates || updateState.status === 'checking'}
              onClick={() => void check()}
            >
              Check now
            </Button>
          </div>
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
