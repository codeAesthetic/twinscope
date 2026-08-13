import { beforeEach, describe, expect, it } from 'vitest';
import { defaultsFor } from './optionDefaults';
import { useProjectsStore } from '../stores/projects';
import { useSettingsStore } from '../stores/settings';
import type { Preferences, Project } from '../../../shared/channels';

/**
 * The two-layer option seeding (v0.2.9) — global defaults, then the active
 * project's preset. This is what discharges v0.2.6's deferred per-project
 * normalisation, so the layering order is the thing worth pinning.
 */

const project = (over: Partial<Project> = {}): Project => ({
  id: 1,
  name: 'Service config',
  presets: {},
  ignores: [],
  createdAt: '2026-08-13 00:00:00',
  ...over,
});

function withState(preferences: Partial<Preferences>, projects: Project[]): void {
  useSettingsStore.setState({
    preferences: {
      theme: 'dark',
      engineDefaults: {},
      checkUpdates: true,
      ...preferences,
    },
    loaded: true,
  });
  useProjectsStore.setState({ projects, saved: [], loaded: true, lastSaved: null });
}

describe('defaultsFor', () => {
  beforeEach(() => withState({}, []));

  it('is the global engine default when no project is active', () => {
    withState({ engineDefaults: { text: { ignoreCase: true } } }, [project()]);
    expect(defaultsFor('text')).toEqual({ ignoreCase: true });
  });

  it('layers the active project over the global default', () => {
    withState(
      {
        engineDefaults: { text: { ignoreCase: true, collapseUnchanged: true } },
        activeProjectId: 1,
      },
      [project({ presets: { text: { ignoreCase: false } } })],
    );
    // The project wins on the key it names and leaves the rest alone — a preset is
    // an override, not a replacement of everything the user set globally.
    expect(defaultsFor('text')).toEqual({ ignoreCase: false, collapseUnchanged: true });
  });

  it('ignores a preset for a different engine', () => {
    withState({ activeProjectId: 1 }, [project({ presets: { json: { ignoreNulls: true } } })]);
    expect(defaultsFor('text')).toEqual({});
  });

  it('adds a project ignore glob under the option each engine already has', () => {
    withState({ activeProjectId: 1 }, [project({ ignores: ['dist/**'] })]);
    expect(defaultsFor('folder')).toEqual({ ignore: ['dist/**'] });
    expect(defaultsFor('json')).toEqual({ ignorePaths: ['dist/**'] });
    // A line diff has no such option, so the globs are simply not applicable.
    expect(defaultsFor('text')).toEqual({});
  });

  it('adds to an existing ignore list rather than replacing it', () => {
    withState(
      { engineDefaults: { folder: { ignore: ['.git', 'node_modules'] } }, activeProjectId: 1 },
      [project({ ignores: ['dist/**', '.git'] })],
    );
    // Replacing would have dropped `.git` and `node_modules`; duplicating `.git`
    // would have it counted twice in the note the engine writes.
    expect(defaultsFor('folder')).toEqual({ ignore: ['.git', 'node_modules', 'dist/**'] });
  });

  it('falls back to the global default when the active project no longer exists', () => {
    // Deleting a project clears the preference, but a stale id must not throw.
    withState({ engineDefaults: { text: { ignoreCase: true } }, activeProjectId: 99 }, [project()]);
    expect(defaultsFor('text')).toEqual({ ignoreCase: true });
  });
});
