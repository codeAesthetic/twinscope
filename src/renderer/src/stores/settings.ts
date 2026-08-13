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

const FALLBACK: Preferences = {
  theme: 'dark',
  engineDefaults: {},
  // Off, matching main's default: a fallback that turned the network check on
  // would make a failed settings read into a privacy decision (v0.2.13).
  checkUpdates: false,
  globalShortcut: false,
  clipboardWatcher: false,
};

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
   * Called by the Settings screen's switches. The theme is the exception and goes
   * through `ThemeProvider` directly, because it has to apply before a round trip
   * completes or the window flashes the wrong palette.
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
