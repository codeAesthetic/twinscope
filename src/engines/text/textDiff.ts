import { diffArrays, diffWordsWithSpace } from 'diff';
import { createNormalizer, DEFAULT_NORMALIZE_OPTIONS } from '../normalize';
import type { NormalizeOptions, Normalizer } from '../normalize';

/**
 * Line diff with intraline detail, modification pairing and folding.
 *
 * Built on jsdiff's Myers implementation for the line pass, with three layers on
 * top that the raw output does not give you:
 *
 *  1. **Pairing** — a removal immediately followed by an addition is usually one
 *     *edited* line, not two unrelated ones. Showing them as a pair is what makes
 *     a diff readable.
 *  2. **Intraline marks** — within a paired line, which words actually changed.
 *  3. **Folding** — long unchanged runs collapse, because nobody reads 400 lines
 *     of context (MD §8.1).
 */

export type TextRowKind = 'ctx' | 'add' | 'del' | 'mod' | 'fold';

export interface TextRow {
  kind: TextRowKind;
  /** Left (before) line number, 1-based. Absent on pure additions. */
  left?: number;
  /** Right (after) line number, 1-based. Absent on pure deletions. */
  right?: number;
  /** Left/context text. Carries ⟦…⟧ marks on `mod` rows. */
  text: string;
  /** Right text, `mod` rows only. */
  textRight?: string;
  /**
   * The BEFORE text of a `ctx` row whose two sides are **not** literally equal.
   *
   * A context row normally carries one string because both sides are the same one.
   * Normalisation breaks that: with `ignoreCase`, or with a v0.2.6 rule masking a
   * regenerated id, two genuinely different lines pair as context — and rendering
   * only one of them would show the reader text that is not in their file. The
   * standing rule is that normalisation changes what is *compared*, never what is
   * *displayed*, so the other side is carried here.
   */
  textBefore?: string;
  /** Hidden line count, `fold` rows only. */
  count?: number;
  /** The rows a fold is hiding, materialised so expanding is instant. */
  hidden?: TextRow[];
}

export interface TextDiffOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  collapseUnchanged: boolean;
  /**
   * The shared normalisation rules (v0.2.6). Optional so that every existing
   * caller and every stored option set from before v0.2.6 still type-checks and
   * still behaves identically — absent means the defaults, which are all off.
   */
  normalize?: NormalizeOptions;
}

/**
 * Shared with the view, which renders the toggles: a default that lived in two
 * places would eventually show "on" for something the engine ran as off.
 */
export const DEFAULT_TEXT_OPTIONS: TextDiffOptions = {
  ignoreWhitespace: true,
  ignoreCase: false,
  collapseUnchanged: true,
  normalize: DEFAULT_NORMALIZE_OPTIONS,
};

export interface TextDiffData {
  rows: TextRow[];
  lines: { before: number; after: number };
}

export interface TextDiffStats {
  added: number;
  removed: number;
  modified: number;
}

/** Beyond this, a naive diff stops being interactive; v0.2.8 handles the rest. */
export const MAX_LINES = 200_000;

/** Unchanged runs longer than this collapse... */
const FOLD_THRESHOLD = 8;
/** ...keeping this many lines of context at each end. */
const FOLD_CONTEXT = 3;

/** Similar enough to read as one edited line rather than a delete plus an add. */
const PAIR_SIMILARITY = 0.34;

/** Intraline diffing is quadratic; skip it on pathological lines. */
const MAX_INTRALINE_CHARS = 2000;

export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

/**
 * The comparison key for a line. Normalisation happens here and nowhere else,
 * so the original text is always what gets displayed.
 */
function lineKey(line: string, options: TextDiffOptions, normalizer?: Normalizer): string {
  let key = line;
  if (options.ignoreWhitespace) key = key.replace(/[ \t]+/g, ' ').trim();
  if (options.ignoreCase) key = key.toLowerCase();
  // v0.2.6: the shared rules mask generated ids, timestamps and hashes. This is
  // still the only place normalisation happens — rows always carry the original
  // text, and a test asserts it.
  if (normalizer !== undefined && !normalizer.inert) key = normalizer.mask(key);
  return key;
}

function tokens(line: string): string[] {
  return line.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? [];
}

/** Token overlap, used only to decide whether two lines are a pair. */
export function similarity(left: string, right: string): number {
  const leftTokens = new Set(tokens(left).filter((token) => token.trim() !== ''));
  const rightTokens = tokens(right).filter((token) => token.trim() !== '');
  if (leftTokens.size === 0 || rightTokens.length === 0) return 0;

  let hits = 0;
  for (const token of rightTokens) if (leftTokens.has(token)) hits += 1;
  return hits / Math.max(leftTokens.size, rightTokens.length);
}

/** Wraps the changed words of each side in ⟦…⟧. */
export function markWords(left: string, right: string): [string, string] {
  if (left.length > MAX_INTRALINE_CHARS || right.length > MAX_INTRALINE_CHARS) {
    return [left, right];
  }

  let markedLeft = '';
  let markedRight = '';

  for (const part of diffWordsWithSpace(left, right)) {
    if (part.added === true) {
      markedRight += `${MARK_OPEN}${part.value}${MARK_CLOSE}`;
    } else if (part.removed === true) {
      markedLeft += `${MARK_OPEN}${part.value}${MARK_CLOSE}`;
    } else {
      markedLeft += part.value;
      markedRight += part.value;
    }
  }

  return [markedLeft, markedRight];
}

/** Collapses long unchanged runs, keeping context at both ends. */
function collapse(rows: TextRow[]): TextRow[] {
  const out: TextRow[] = [];
  let run: TextRow[] = [];

  const flush = (): void => {
    if (run.length === 0) return;

    if (run.length > FOLD_THRESHOLD) {
      const hidden = run.slice(FOLD_CONTEXT, -FOLD_CONTEXT);
      out.push(...run.slice(0, FOLD_CONTEXT));
      out.push({ kind: 'fold', text: '', count: hidden.length, hidden });
      out.push(...run.slice(-FOLD_CONTEXT));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const row of rows) {
    if (row.kind === 'ctx') run.push(row);
    else {
      flush();
      out.push(row);
    }
  }
  flush();

  return out;
}

/**
 * Context rows whose two sides were not literally equal — they paired because
 * normalisation masked the part that differed, which is exactly what `textBefore`
 * marks.
 *
 * Counted from the finished rows rather than inside `lineKey`, which runs once per
 * candidate comparison during the LCS and would count the same line many times.
 */
function countMaskedPairs(rows: readonly TextRow[], normalizer: Normalizer): number {
  if (normalizer.inert) return 0;
  return rows.filter((row) => row.kind === 'ctx' && row.textBefore !== undefined).length;
}

export function diffText(
  before: string,
  after: string,
  options: TextDiffOptions,
): { data: TextDiffData; stats: TextDiffStats; notes: string[] } {
  // Line endings are normalised always: a CRLF/LF mismatch is a property of the
  // files, not a difference anyone wants to read line by line.
  const linesBefore = before.replace(/\r\n/g, '\n').split('\n');
  const linesAfter = after.replace(/\r\n/g, '\n').split('\n');
  const normalizer = createNormalizer(options.normalize ?? DEFAULT_NORMALIZE_OPTIONS);

  if (linesBefore.length + linesAfter.length > MAX_LINES * 2) {
    throw new Error(
      `These files are too large for the line-by-line view (${linesBefore.length + linesAfter.length} lines). Streaming support arrives in a later release.`,
    );
  }

  const chunks = diffArrays(linesBefore, linesAfter, {
    comparator: (left, right) =>
      lineKey(left, options, normalizer) === lineKey(right, options, normalizer),
  });

  const rows: TextRow[] = [];
  const stats: TextDiffStats = { added: 0, removed: 0, modified: 0 };
  let leftNo = 1;
  let rightNo = 1;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;

    if (chunk.added !== true && chunk.removed !== true) {
      for (const line of chunk.value) {
        // `chunk.value` for a common run comes from the AFTER array. When the
        // comparator paired two lines that are not identical, the BEFORE line has
        // to travel too or the reader is shown text they do not have.
        const original = linesBefore[leftNo - 1];
        rows.push({
          kind: 'ctx',
          left: leftNo,
          right: rightNo,
          text: line,
          ...(original !== undefined && original !== line ? { textBefore: original } : {}),
        });
        leftNo += 1;
        rightNo += 1;
      }
      continue;
    }

    // Gather this run of changes so removals can pair with additions.
    const removed = chunk.removed === true ? [...chunk.value] : [];
    const added = chunk.added === true ? [...chunk.value] : [];

    const next = chunks[index + 1];
    if (chunk.removed === true && next?.added === true) {
      added.push(...next.value);
      index += 1;
    }

    const pairs = Math.min(removed.length, added.length);
    let pairIndex = 0;

    for (; pairIndex < pairs; pairIndex += 1) {
      const left = removed[pairIndex]!;
      const right = added[pairIndex]!;

      if (similarity(left, right) > PAIR_SIMILARITY) {
        const [markedLeft, markedRight] = markWords(left, right);
        rows.push({
          kind: 'mod',
          left: leftNo,
          right: rightNo,
          text: markedLeft,
          textRight: markedRight,
        });
        stats.modified += 1;
      } else {
        rows.push({ kind: 'del', left: leftNo, text: left });
        rows.push({ kind: 'add', right: rightNo, text: right });
        stats.removed += 1;
        stats.added += 1;
      }
      leftNo += 1;
      rightNo += 1;
    }

    for (let rest = pairIndex; rest < removed.length; rest += 1) {
      rows.push({ kind: 'del', left: leftNo, text: removed[rest]! });
      stats.removed += 1;
      leftNo += 1;
    }
    for (let rest = pairIndex; rest < added.length; rest += 1) {
      rows.push({ kind: 'add', right: rightNo, text: added[rest]! });
      stats.added += 1;
      rightNo += 1;
    }
  }

  const notes = ['Normalised line endings (CRLF → LF).'];
  // Masked lines that paired only because a rule hid the difference. Counted here
  // rather than inside `lineKey`, which runs for every candidate comparison.
  const maskedPairs = countMaskedPairs(rows, normalizer);
  if (maskedPairs > 0) {
    notes.push(
      `Ignored ${maskedPairs} line${maskedPairs === 1 ? '' : 's'} that differ only by a normalisation rule.`,
    );
  }
  if (options.ignoreWhitespace) notes.push('Ignored leading, trailing and repeated whitespace.');
  if (options.ignoreCase) notes.push('Ignored case.');
  if (options.collapseUnchanged) notes.push('Collapsed unchanged sections longer than 8 lines.');

  return {
    data: {
      rows: options.collapseUnchanged ? collapse(rows) : rows,
      lines: { before: linesBefore.length, after: linesAfter.length },
    },
    stats,
    notes,
  };
}
