import { create } from 'zustand';
import type { Preferences } from '../../../shared/channels';

/**
 * Preferences that outlive the window, mirrored from main's `settings.json`.
 *
 * Engine defaults live here rather than in the compare store because they are a
 * property of the user, not of the current pair: they seed every new comparison
 * and are then overridden per-run by whatever the engine view changes.
 */
interface SettingsState {
  preferences: Preferences;
  loaded: boolean;

  load: () => Promise<void>;
  update: (patch: Partial<Preferences>) => Promise<void>;
  /** Merges one engine's defaults without disturbing the others. */
  setEngineDefault: (engineId: string, patch: Record<string, unknown>) => Promise<void>;
}

const FALLBACK: Preferences = { theme: 'dark', engineDefaults: {}, checkUpdates: true };

export const useSettingsStore = create<SettingsState>((set, get) => ({
  preferences: FALLBACK,
  loaded: false,

  load: async () => {
    try {
      set({ preferences: await window.twinscope.settings.read(), loaded: true });
    } catch {
      set({ preferences: FALLBACK, loaded: true });
    }
  },

  /**
   * Writes a preference patch.
   *
   * **Currently has no caller.** Its only one was the Settings screen's
   * "check for updates" switch, which v0.2.13 disabled — the preference promised
   * signed, verified releases and nothing checked anything. Kept rather than
   * deleted because the theme goes through `ThemeProvider` directly and
   * `engineDefaults` has no editor yet, so this is the writer both will want; a
   * reader finding it unused should not conclude preferences are read-only.
   */
  update: async (patch) => {
    set({ preferences: { ...get().preferences, ...patch } });
    const saved = await window.twinscope.settings.write(patch);
    set({ preferences: saved });
  },

  setEngineDefault: async (engineId, patch) => {
    const { engineDefaults } = get().preferences;
    await get().update({
      engineDefaults: {
        ...engineDefaults,
        [engineId]: { ...engineDefaults[engineId], ...patch },
      },
    });
  },
}));

/** The options a fresh comparison starts from, for the engine about to run. */
export function defaultsFor(engineId: string): Record<string, unknown> {
  return useSettingsStore.getState().preferences.engineDefaults[engineId] ?? {};
}
