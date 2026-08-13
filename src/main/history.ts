import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { InputPayload, Summary } from '../shared/channels';

/**
 * Comparison history (MD §36, plan §3.6).
 *
 * **Never stores file contents** (Rule 2 / D9). A row holds paths, names, sizes,
 * kinds, options and the summary — enough to describe and reopen a comparison,
 * and nothing that would turn the history file into a copy of the user's data.
 * `record()` strips `text` on the way in rather than trusting its caller.
 *
 * Uses Node's built-in `node:sqlite` rather than better-sqlite3 (D9). Same
 * engine, no native module to rebuild for every Electron ABI, and no install
 * step that can fail on a user's machine.
 */

/** 2 since v0.2.9, which added `projects` and `saved_comparisons` (plan §3.6). */
const SCHEMA_VERSION = 2;

/** Older unstarred rows are pruned past this, so history never grows forever. */
const MAX_ROWS = 500;

export interface StoredInput {
  kind: string;
  name: string;
  path?: string;
  size: number;
}

export interface HistoryRow {
  id: number;
  title: string;
  engineId: string;
  a: StoredInput;
  b: StoredInput;
  options: Record<string, unknown>;
  summary: Summary;
  starred: boolean;
  createdAt: string;
  openedAt: string;
}

interface RawRow {
  id: number;
  title: string;
  engine_id: string;
  input_a: string;
  input_b: string;
  options: string;
  summary: string;
  starred: number;
  created_at: string;
  opened_at: string;
}

let db: DatabaseSync | null = null;

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      engine_id   TEXT NOT NULL,
      input_a     TEXT NOT NULL,
      input_b     TEXT NOT NULL,
      options     TEXT NOT NULL DEFAULT '{}',
      summary     TEXT NOT NULL DEFAULT '{}',
      starred     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      opened_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comp_opened ON comparisons(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comp_starred ON comparisons(starred, opened_at DESC);

    -- v0.2.9. Both are additive and IF NOT EXISTS, so an existing history file
    -- gains them without a row being touched; main/projects.ts owns their code.
    -- (No backticks in here: this is a template literal, and one would end it.)
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      root        TEXT,                          -- folder scope; null = no scope
      presets     TEXT NOT NULL DEFAULT '{}',    -- { [engineId]: options }
      ignores     TEXT NOT NULL DEFAULT '[]',    -- glob strings
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER,                       -- null = saved without a project
      name        TEXT NOT NULL,
      engine_id   TEXT NOT NULL,
      input_a     TEXT NOT NULL,                 -- StoredInput, contents stripped
      input_b     TEXT NOT NULL,
      options     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_saved_project ON saved_comparisons(project_id, created_at DESC);
  `);

  database
    .prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)')
    .run(SCHEMA_VERSION);
}

/** Opened lazily: the first comparison pays for it, not startup. */
function open(): DatabaseSync {
  if (db !== null) return db;
  db = new DatabaseSync(join(app.getPath('userData'), 'twinscope.db'));
  migrate(db);
  return db;
}

/**
 * The one open database, for the other feature that lives in it (v0.2.9).
 *
 * `main/projects.ts` uses this rather than opening its own handle: two
 * connections to one SQLite file is how a write ends up locked out by a read, and
 * the migration that creates its tables is the one above.
 */
export function database(): DatabaseSync {
  return open();
}

/** Test seam: point the database somewhere disposable. */
export function openAt(path: string): DatabaseSync {
  db = new DatabaseSync(path);
  migrate(db);
  return db;
}

export function closeHistory(): void {
  db?.close();
  db = null;
}

/**
 * The only shape that reaches the database. Contents are dropped here — not by
 * the caller — so no future caller can leak them by forgetting.
 */
function strip(input: InputPayload): StoredInput {
  return {
    kind: input.kind,
    name: input.name,
    ...(input.path !== undefined ? { path: input.path } : {}),
    size: input.size,
  };
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function toRow(raw: RawRow): HistoryRow {
  return {
    id: raw.id,
    title: raw.title,
    engineId: raw.engine_id,
    a: parse<StoredInput>(raw.input_a, { kind: 'unknown', name: '?', size: 0 }),
    b: parse<StoredInput>(raw.input_b, { kind: 'unknown', name: '?', size: 0 }),
    options: parse<Record<string, unknown>>(raw.options, {}),
    summary: parse<Summary>(raw.summary, { added: 0, removed: 0, modified: 0 }),
    starred: raw.starred === 1,
    createdAt: raw.created_at,
    openedAt: raw.opened_at,
  };
}

export interface RecordInput {
  a: InputPayload;
  b: InputPayload;
  engineId: string;
  options: Record<string, unknown>;
  summary: Summary;
}

/**
 * Writes one completed comparison.
 *
 * Re-running the same pair updates the existing row rather than stacking
 * duplicates — history is a list of *things you compared*, not of button
 * presses, and a normalisation toggle would otherwise flood it.
 */
export function record(input: RecordInput): HistoryRow {
  const database = open();
  const a = strip(input.a);
  const b = strip(input.b);
  const title = `${a.name} ↔ ${b.name}`;

  const existing = database
    .prepare(
      `SELECT id FROM comparisons
       WHERE engine_id = ? AND input_a = ? AND input_b = ?
       ORDER BY opened_at DESC LIMIT 1`,
    )
    .get(input.engineId, JSON.stringify(a), JSON.stringify(b)) as { id: number } | undefined;

  if (existing !== undefined) {
    database
      .prepare(
        `UPDATE comparisons
         SET options = ?, summary = ?, opened_at = datetime('now')
         WHERE id = ?`,
      )
      .run(JSON.stringify(input.options), JSON.stringify(input.summary), existing.id);
    return get(existing.id) as HistoryRow;
  }

  const result = database
    .prepare(
      `INSERT INTO comparisons (title, engine_id, input_a, input_b, options, summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      title,
      input.engineId,
      JSON.stringify(a),
      JSON.stringify(b),
      JSON.stringify(input.options),
      JSON.stringify(input.summary),
    );

  prune();
  return get(Number(result.lastInsertRowid)) as HistoryRow;
}

/** Drops the oldest unstarred rows once the table outgrows the cap. */
function prune(): void {
  const database = open();
  database
    .prepare(
      `DELETE FROM comparisons
       WHERE starred = 0 AND id NOT IN (
         SELECT id FROM comparisons ORDER BY starred DESC, opened_at DESC LIMIT ?
       )`,
    )
    .run(MAX_ROWS);
}

export function list(options: { limit?: number; starredOnly?: boolean } = {}): HistoryRow[] {
  const database = open();
  const rows = database
    .prepare(
      `SELECT * FROM comparisons
       ${options.starredOnly === true ? 'WHERE starred = 1' : ''}
       ORDER BY opened_at DESC
       LIMIT ?`,
    )
    .all(options.limit ?? MAX_ROWS) as unknown as RawRow[];

  return rows.map(toRow);
}

export function get(id: number): HistoryRow | null {
  const raw = open().prepare('SELECT * FROM comparisons WHERE id = ?').get(id) as
    RawRow | undefined;
  return raw === undefined ? null : toRow(raw);
}

/** Bumped when a comparison is reopened, so history stays ordered by relevance. */
export function touch(id: number): void {
  open().prepare(`UPDATE comparisons SET opened_at = datetime('now') WHERE id = ?`).run(id);
}

export function setStarred(id: number, starred: boolean): void {
  open()
    .prepare('UPDATE comparisons SET starred = ? WHERE id = ?')
    .run(starred ? 1 : 0, id);
}

export function remove(id: number): void {
  open().prepare('DELETE FROM comparisons WHERE id = ?').run(id);
}

/** Clears everything, including starred rows — the user asked for everything. */
export function clear(): void {
  open().exec('DELETE FROM comparisons');
}
