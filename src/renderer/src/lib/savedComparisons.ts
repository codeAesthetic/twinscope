import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';
import { activeProjectId, useProjectsStore } from '../stores/projects';
import type { Project, SavedComparison } from '../../../shared/channels';

/**
 * The three things that connect a saved comparison to the comparison on screen
 * (v0.2.9).
 *
 * They live here rather than in `stores/projects.ts` because that store is imported
 * by `stores/settings.ts`'s option layering, and the compare store imports *that* —
 * a store reaching back the other way is a module cycle whose only symptom is an
 * undefined at init. Plain functions, so the toolbar button, ⌘S and the palette all
 * call the same code.
 */

/** Saves the current pair as a definition. Null when there is nothing to save. */
export async function saveCurrentComparison(name?: string): Promise<SavedComparison | null> {
  const { a, b, result, options } = useCompareStore.getState();
  if (a === null || b === null || result === null) return null;

  const projectId = activeProjectId();
  const entry = await window.twinscope.saved.save({
    ...(projectId !== null ? { projectId } : {}),
    name: name ?? `${a.name} ↔ ${b.name}`,
    engineId: result.engineId,
    a,
    b,
    options,
  });

  // Whoever asked — ⌘S, the toolbar, the palette — gets the same confirmation.
  useProjectsStore.setState({ lastSaved: entry });
  await useProjectsStore.getState().refreshSaved();
  return entry;
}

/**
 * Opens a saved comparison: re-read both inputs, re-run with its options.
 *
 * Goes through the compare store's `reopen`, which is history's path — a missing
 * input already explains itself there, and having two ways to restore a comparison
 * would mean two behaviours when a file has moved.
 */
export async function openSavedComparison(entry: SavedComparison): Promise<void> {
  await window.twinscope.saved.touch(entry.id);
  await useCompareStore.getState().reopen({
    id: entry.id,
    title: entry.name,
    engineId: entry.engineId,
    a: entry.a,
    b: entry.b,
    options: entry.options,
    summary: { added: 0, removed: 0, modified: 0 },
    starred: false,
    createdAt: entry.createdAt,
    openedAt: entry.lastRunAt ?? entry.createdAt,
  });
  await useProjectsStore.getState().refreshSaved();
}

/**
 * Stores the options on screen as a project's preset for that engine.
 *
 * Captured from a real comparison rather than authored in a form: every engine's
 * options already have a UI, and a second one inside Projects is a second place for
 * the same controls to drift.
 */
export async function capturePreset(project: Project): Promise<boolean> {
  const { result, options } = useCompareStore.getState();
  if (result === null) {
    useAppStore
      .getState()
      .setNotice('Run a comparison first — a preset is taken from one, not typed in.');
    return false;
  }

  await useProjectsStore.getState().save({
    id: project.id,
    name: project.name,
    ...(project.root !== undefined ? { root: project.root } : {}),
    presets: { ...project.presets, [result.engineId]: options },
    ignores: project.ignores,
  });
  return true;
}
