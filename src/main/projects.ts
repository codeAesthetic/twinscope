import { database } from './history';
import type { InputPayload } from '../shared/channels';
import type { Project, SavedComparison, StoredInput } from '../shared/channels';

/**
 * Projects and saved comparisons (v0.2.9, MD §37 / A19).
 *
 * Two tables in the history database — created by `history.ts`'s migration, since
 * there is one file and one connection. What lives here is the code, not a second
 * schema.
 *
 * Three decisions the code depends on:
 *
 *  - **A saved comparison stores no file contents**, like a history row: it is a
 *    *definition* (inputs, engine, options), and opening one re-reads from disk and
 *    re-runs. A cached answer to "what changed" is a wrong answer waiting to be read.
 *  - **A project is optional scope**, never a container you have to create first.
 *    Nothing requires one; choosing one seeds new comparisons with its presets.
 *  - **Deleting a project keeps its comparisons**, unattached. Foreign keys are
 *    enforced here rather than by the schema because `node:sqlite` leaves
 *    `PRAGMA foreign_keys` off per connection, and a pragma someone forgets is a
 *    silent data bug — an explicit UPDATE cannot be forgotten by a new connection.
 */

interface RawProject {
  id: number;
  name: string;
  root: string | null;
  presets: string;
  ignores: string;
  created_at: string;
}

interface RawSaved {
  id: number;
  project_id: number | null;
  name: string;
  engine_id: string;
  input_a: string;
  input_b: string;
  options: string;
  created_at: string;
  last_run_at: string | null;
}

const MAX_PROJECTS = 200;
const MAX_SAVED = 500;

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function toProject(raw: RawProject): Project {
  return {
    id: raw.id,
    name: raw.name,
    ...(raw.root !== null ? { root: raw.root } : {}),
    presets: parse<Record<string, Record<string, unknown>>>(raw.presets, {}),
    ignores: parse<string[]>(raw.ignores, []),
    createdAt: raw.created_at,
  };
}

/** Same stripping rule as history's, and for the same reason (Rule 2). */
function strip(input: InputPayload | StoredInput): StoredInput {
  return {
    kind: input.kind,
    name: input.name,
    ...(input.path !== undefined ? { path: input.path } : {}),
    size: input.size,
  };
}

function toSaved(raw: RawSaved): SavedComparison {
  return {
    id: raw.id,
    ...(raw.project_id !== null ? { projectId: raw.project_id } : {}),
    name: raw.name,
    engineId: raw.engine_id,
    a: parse<StoredInput>(raw.input_a, { kind: 'unknown', name: '?', size: 0 }),
    b: parse<StoredInput>(raw.input_b, { kind: 'unknown', name: '?', size: 0 }),
    options: parse<Record<string, unknown>>(raw.options, {}),
    createdAt: raw.created_at,
    ...(raw.last_run_at !== null ? { lastRunAt: raw.last_run_at } : {}),
  };
}

export function listProjects(): Project[] {
  const rows = database()
    .prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC LIMIT ?')
    .all(MAX_PROJECTS) as unknown as RawProject[];
  return rows.map(toProject);
}

export function getProject(id: number): Project | null {
  const raw = database().prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    RawProject | undefined;
  return raw === undefined ? null : toProject(raw);
}

export interface ProjectPatch {
  id?: number;
  name: string;
  root?: string;
  presets?: Record<string, Record<string, unknown>>;
  ignores?: string[];
}

/**
 * Creates or updates a project, and returns it as stored.
 *
 * One entry point for both, because the Projects screen edits a row the moment it
 * exists — a separate `create` and `update` would mean two shapes to validate and
 * two places for the presets JSON to be written differently.
 */
export function saveProject(patch: ProjectPatch): Project {
  const db = database();

  if (patch.id !== undefined) {
    const existing = getProject(patch.id);
    if (existing === null) throw new Error('That project no longer exists.');
    const next: Project = {
      ...existing,
      name: patch.name,
      ...(patch.root !== undefined ? { root: patch.root } : {}),
      ...(patch.presets !== undefined ? { presets: patch.presets } : {}),
      ...(patch.ignores !== undefined ? { ignores: patch.ignores } : {}),
    };
    db.prepare('UPDATE projects SET name = ?, root = ?, presets = ?, ignores = ? WHERE id = ?').run(
      next.name,
      next.root ?? null,
      JSON.stringify(next.presets),
      JSON.stringify(next.ignores),
      patch.id,
    );
    return getProject(patch.id) as Project;
  }

  const result = db
    .prepare('INSERT INTO projects (name, root, presets, ignores) VALUES (?, ?, ?, ?)')
    .run(
      patch.name,
      patch.root ?? null,
      JSON.stringify(patch.presets ?? {}),
      JSON.stringify(patch.ignores ?? []),
    );
  return getProject(Number(result.lastInsertRowid)) as Project;
}

/**
 * Deletes a project and **keeps** its saved comparisons, unattached.
 *
 * A project is a lens on work, not the owner of it. The detach is an explicit
 * statement rather than an `ON DELETE SET NULL`, which would not fire at all: this
 * connection has `PRAGMA foreign_keys` at its default of off.
 */
export function removeProject(id: number): void {
  const db = database();
  db.prepare('UPDATE saved_comparisons SET project_id = NULL WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function listSaved(projectId?: number): SavedComparison[] {
  const db = database();
  const rows = (projectId === undefined
    ? db.prepare('SELECT * FROM saved_comparisons ORDER BY created_at DESC LIMIT ?').all(MAX_SAVED)
    : db
        .prepare(
          'SELECT * FROM saved_comparisons WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(projectId, MAX_SAVED)) as unknown as RawSaved[];
  return rows.map(toSaved);
}

export function getSaved(id: number): SavedComparison | null {
  const raw = database().prepare('SELECT * FROM saved_comparisons WHERE id = ?').get(id) as
    RawSaved | undefined;
  return raw === undefined ? null : toSaved(raw);
}

export interface SavePatch {
  projectId?: number;
  name: string;
  engineId: string;
  a: InputPayload;
  b: InputPayload;
  options: Record<string, unknown>;
}

/**
 * Saves a comparison definition.
 *
 * Re-saving the same pair under the same project updates that row rather than
 * stacking near-duplicates, which is the rule history already follows: pressing ⌘S
 * twice describes one saved comparison, not two.
 */
export function saveComparison(patch: SavePatch): SavedComparison {
  const db = database();
  const a = strip(patch.a);
  const b = strip(patch.b);
  const projectId = patch.projectId ?? null;

  const existing = db
    .prepare(
      `SELECT id FROM saved_comparisons
       WHERE engine_id = ? AND input_a = ? AND input_b = ?
         AND ((project_id IS NULL AND ? IS NULL) OR project_id = ?)
       LIMIT 1`,
    )
    .get(patch.engineId, JSON.stringify(a), JSON.stringify(b), projectId, projectId) as
    { id: number } | undefined;

  if (existing !== undefined) {
    db.prepare('UPDATE saved_comparisons SET name = ?, options = ? WHERE id = ?').run(
      patch.name,
      JSON.stringify(patch.options),
      existing.id,
    );
    return getSaved(existing.id) as SavedComparison;
  }

  const result = db
    .prepare(
      `INSERT INTO saved_comparisons (project_id, name, engine_id, input_a, input_b, options)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      patch.name,
      patch.engineId,
      JSON.stringify(a),
      JSON.stringify(b),
      JSON.stringify(patch.options),
    );

  return getSaved(Number(result.lastInsertRowid)) as SavedComparison;
}

export function removeSaved(id: number): void {
  database().prepare('DELETE FROM saved_comparisons WHERE id = ?').run(id);
}

/** Marks a saved comparison as run, so the list can order by relevance. */
export function touchSaved(id: number): SavedComparison | null {
  database()
    .prepare(`UPDATE saved_comparisons SET last_run_at = datetime('now') WHERE id = ?`)
    .run(id);
  return getSaved(id);
}
