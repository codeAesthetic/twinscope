import { useProjectsStore } from '../stores/projects';
import { useSettingsStore } from '../stores/settings';

/**
 * The options a fresh comparison starts from, for the engine about to run.
 *
 * **Two layers since v0.2.9**: the user's global defaults for that engine, then the
 * active project's preset over them. That is v0.2.6's deferred per-project
 * normalisation, and it lands in the one function `compare.run()` already asks — so
 * no engine view has to learn that projects exist.
 *
 * It lives in `lib/` rather than in either store because both are involved: the
 * projects store reads preferences, so a `defaultsFor` inside `stores/settings.ts`
 * would close a cycle between the two whose only symptom is an undefined at
 * module-init time.
 */
export function defaultsFor(engineId: string): Record<string, unknown> {
  const preferences = useSettingsStore.getState().preferences;
  const global = preferences.engineDefaults[engineId] ?? {};

  const project = useProjectsStore
    .getState()
    .projects.find((candidate) => candidate.id === preferences.activeProjectId);
  if (project === undefined) return global;

  const merged: Record<string, unknown> = { ...global, ...(project.presets[engineId] ?? {}) };

  // A project's ignore globs are layered under whatever option name that engine
  // already has — and *added* to its own defaults rather than replacing them, or
  // naming one project pattern would quietly drop `.git` and `node_modules`.
  const key = IGNORE_OPTION[engineId];
  if (key !== undefined && project.ignores.length > 0) {
    const existing = Array.isArray(merged[key]) ? (merged[key] as string[]) : [];
    merged[key] = [...new Set([...existing, ...project.ignores])];
  }

  return merged;
}

/** Which option each engine spells "ignore these". Absent = it has no such option. */
const IGNORE_OPTION: Record<string, string> = {
  folder: 'ignore',
  json: 'ignorePaths',
  yaml: 'ignorePaths',
  xml: 'ignorePaths',
};
