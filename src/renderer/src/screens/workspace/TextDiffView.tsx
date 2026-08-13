import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { NormalizeControls } from '../../components/compare/NormalizeControls';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { useSearchStore } from '../../stores/search';
import { useViewModeStore } from '../../stores/viewMode';
import { countMatches, segmentRow, stripMarks } from '../../lib/searchMatch';
import { ensureLanguage, isHighlightable, tokenizeLine } from '../../lib/highlight';
import { useViewModeCycle } from '../../lib/viewMode';
import { useTheme } from '../../theme/ThemeProvider';
import {
  DEFAULT_TEXT_OPTIONS,
  MARK_CLOSE,
  MARK_OPEN,
  type TextDiffData,
  type TextDiffOptions,
  type TextRow,
} from '../../../../engines/text';
import type { EngineViewProps } from './engineViews';

type ViewMode = 'side' | 'unified' | 'inline';

/** Seg order, and the order `⌘\` cycles through. */
const VIEW_MODES: readonly ViewMode[] = ['side', 'unified', 'inline'];

/** One painted row. See the `rows` memo for why this is not just a `TextRow`. */
interface DisplayRow {
  row: TextRow;
  /** Index into `data.rows` — the key `expanded` uses, not a position here. */
  dataIndex: number;
  /** False for the `+ new` half of a unified modification: one change, one stop. */
  anchor: boolean;
}

const ROW_HEIGHT = 20;

/**
 * The most one fold may fetch from disk (v0.2.8) — `main/input.ts` enforces the
 * same number, and this copy is what lets the row say so before it is clicked.
 */
const MAX_LAZY_BYTES = 4 * 1024 * 1024;

/** Lines of a lazily loaded span, as context rows numbered from the fold's start. */
function lazyRows(text: string, left: number, right: number): TextRow[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (body === '') return [];
  return body.split('\n').map((line, at) => ({
    kind: 'ctx' as const,
    left: left + at,
    right: right + at,
    text: line,
  }));
}

/**
 * The text/code diff (MD §8.1): side-by-side, unified and inline, virtualised.
 *
 * One virtualised list of row *pairs* rather than two scrolling columns — that
 * way the sides cannot drift out of alignment and there is no scroll to
 * synchronise.
 */
export default function TextDiffView({ result }: EngineViewProps) {
  const data = result.data as TextDiffData;
  /** Survives the remount a normalisation re-run causes — see `stores/viewMode.ts`. */
  const rawMode = useViewModeStore((state) => state.modeFor(result.engineId, 'side'));
  const mode = (VIEW_MODES as readonly string[]).includes(rawMode) ? (rawMode as ViewMode) : 'side';
  const setStoredMode = useViewModeStore((state) => state.set);
  const cycleStoredMode = useViewModeStore((state) => state.cycle);
  const setMode = useCallback(
    (next: ViewMode) => setStoredMode(result.engineId, next),
    [setStoredMode, result.engineId],
  );
  const cycleMode = useCallback(
    () => cycleStoredMode(result.engineId, VIEW_MODES),
    [cycleStoredMode, result.engineId],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  /**
   * Rows fetched for a fold that never carried any (v0.2.8).
   *
   * Large-file mode hands over a byte range instead of the lines, because holding
   * them would defeat the point of never reading the file. Keyed by the same index
   * `expanded` is, so the two cannot drift.
   */
  const [fetched, setFetched] = useState<ReadonlyMap<number, TextRow[]>>(new Map());
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);

  /**
   * Normalisation is the engine's business, not the view's: these re-run the
   * comparison rather than filtering rows, so the counts in the strip always
   * describe the diff on screen (Rule 3).
   */
  const options: TextDiffOptions = useMemo(
    () => ({ ...DEFAULT_TEXT_OPTIONS, ...(storeOptions as Partial<TextDiffOptions>) }),
    [storeOptions],
  );
  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);
  const registerMatches = useSearchStore((state) => state.registerMatches);
  const currentMatch = useSearchStore((state) => state.current);

  const { theme } = useTheme();

  useViewModeCycle(cycleMode);

  /**
   * The language comes from whichever side detection identified — a `.ts` file
   * compared against a clipboard paste still highlights as TypeScript.
   */
  const lang = a?.lang ?? b?.lang;
  const [highlightReady, setHighlightReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHighlightReady(false);
    // Grammars and themes load on demand; until they resolve the diff renders
    // as plain text, which is also the permanent answer for a log file.
    void ensureLanguage(lang, theme).then((ok) => {
      if (!cancelled) setHighlightReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [lang, theme]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * The match-reveal effect runs before `useVirtualizer` is declared, so it
   * reaches the instance through a ref rather than reordering the hooks.
   */
  const virtualizerRef = useRef<Pick<
    ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>,
    'scrollToIndex'
  > | null>(null);

  useEffect(() => {
    enableSearch('Search in diff…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  /**
   * Exactly what gets painted, one entry per visual row.
   *
   * Unified is the only mode that changes the count: there a modified line
   * becomes **two** rows, `− old` then `+ new`, which is what unified means
   * everywhere else. It used to render as a single `del` row carrying only the
   * old text, so the replacement was absent from the DOM entirely — the diff
   * showed what went away and never what arrived.
   */
  const rows = useMemo(() => {
    const out: DisplayRow[] = [];

    const push = (row: TextRow, dataIndex: number): void => {
      // A split half is still one change: `anchor: false` keeps the `+` line
      // from becoming a second stop in change navigation.
      if (mode === 'unified' && row.kind === 'mod') {
        // Each half keeps only its own line number, or the `+` line claims a
        // "before" number it does not have.
        const { textRight, left, right, ...rest } = row;
        out.push({
          row: { ...rest, kind: 'del', ...(left !== undefined && { left }) },
          dataIndex,
          anchor: true,
        });
        out.push({
          row: {
            ...rest,
            kind: 'add',
            text: textRight ?? '',
            ...(right !== undefined && { right }),
          },
          dataIndex,
          anchor: false,
        });
        return;
      }
      out.push({ row, dataIndex, anchor: true });
    };

    data.rows.forEach((row, index) => {
      if (row.kind === 'fold' && expanded.has(index)) {
        // `dataIndex` stays the fold's own index, which is what `expanded` is
        // keyed by. Passing the position in *this* list instead meant that once
        // one fold had grown the list, every later fold's index was wrong and
        // clicking it expanded nothing.
        for (const hiddenRow of row.hidden ?? fetched.get(index) ?? []) push(hiddenRow, index);
        return;
      }
      push(row, index);
    });
    return out;
  }, [data.rows, expanded, fetched, mode]);

  /** Indices of navigable changes, in document order. */
  const changeRows = useMemo(
    () =>
      rows
        .map((entry, index) => ({ ...entry, index }))
        .filter(({ row, anchor }) => anchor && row.kind !== 'ctx' && row.kind !== 'fold'),
    [rows],
  );

  /**
   * Every match, in document order, as `{ row, hit }`.
   *
   * Built over the *displayed* text, so a modified line contributes its left
   * side then its right — which is the order the eye reads them in.
   */
  const matches = useMemo(() => {
    const needle = query.trim();
    if (needle === '') return [];

    const found: Array<{ row: number; hit: number }> = [];
    rows.forEach(({ row }, index) => {
      // Every row paints `text`, including additions — they were excluded here,
      // so a word that appeared only on an added line could not be found at all.
      const total =
        countMatches(row.text, needle) +
        (row.kind === 'mod' ? countMatches(row.textRight ?? '', needle) : 0);
      for (let hit = 0; hit < total; hit += 1) found.push({ row: index, hit });
    });
    return found;
  }, [rows, query]);

  useEffect(() => {
    registerMatches(matches.length, (index) => {
      const target = matches[index];
      if (target !== undefined) {
        virtualizerRef.current?.scrollToIndex(target.row, { align: 'center' });
      }
    });
  }, [registerMatches, matches]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

  virtualizerRef.current = virtualizer;

  useEffect(() => {
    register(changeRows.length, (changeIndex) => {
      const target = changeRows[changeIndex];
      if (target !== undefined) {
        virtualizer.scrollToIndex(target.index, { align: 'center' });
      }
    });
    return clearNav;
  }, [register, clearNav, changeRows, virtualizer]);

  const currentRowIndex = current === -1 ? -1 : (changeRows[current]?.index ?? -1);
  const activeMatch = currentMatch === -1 ? undefined : matches[currentMatch];

  /**
   * Opens a fold, whichever kind it is.
   *
   * A fold from the ordinary text engine carries its rows and expanding is a set
   * operation. A large-file fold (v0.2.8) carries a byte range instead, so its lines
   * are fetched once and remembered — the file is far too big to have kept them.
   */
  const openFold = async (row: TextRow, dataIndex: number): Promise<void> => {
    const range = row.range;
    if (range !== undefined && row.hidden === undefined && !fetched.has(dataIndex)) {
      const text = await window.twinscope.input.range(range);
      const rowsForFold = lazyRows(text, row.left ?? 1, row.right ?? 1);
      setFetched((previous) => new Map(previous).set(dataIndex, rowsForFold));
    }
    setExpanded((previous) => new Set(previous).add(dataIndex));
  };

  // Mode-independent by construction: in unified a modification is already
  // split into a `del` half and an `add` half carrying the new text, so the
  // same filter yields the same lines in every mode.
  const copyChangedLines = async (): Promise<void> => {
    const text = rows
      .map(({ row }) => row)
      .filter((row) => row.kind === 'add' || row.kind === 'mod')
      .map((row) => stripMarks(row.kind === 'mod' ? (row.textRight ?? '') : row.text))
      .join('\n');
    await window.twinscope.clipboard.write(text);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Diff view mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'side', label: 'Side-by-side' },
            { value: 'unified', label: 'Unified' },
            { value: 'inline', label: 'Inline' },
          ]}
        />
        <Toggle
          pressed={options.ignoreWhitespace}
          onChange={(next) => void setOptions({ ignoreWhitespace: next })}
        >
          Ignore whitespace
        </Toggle>
        <Toggle
          pressed={options.ignoreCase}
          onChange={(next) => void setOptions({ ignoreCase: next })}
        >
          Ignore case
        </Toggle>
        <Toggle
          pressed={options.collapseUnchanged}
          onChange={(next) => void setOptions({ collapseUnchanged: next })}
        >
          Collapse unchanged
        </Toggle>
        <Toggle
          pressed={expanded.size > 0}
          onChange={(next) =>
            setExpanded(
              next
                ? // Only folds that already carry their rows: expanding all in
                  // large-file mode would fetch every unchanged span in the file.
                  new Set(
                    data.rows.map((row, index) =>
                      row.kind === 'fold' && row.hidden !== undefined ? index : -1,
                    ),
                  )
                : new Set(),
            )
          }
        >
          Expand all
        </Toggle>
        <Button size="sm" onClick={() => void copyChangedLines()} data-testid="copy-changed-lines">
          Copy changed lines
        </Button>
      </ToolbarSlot>

      <div className="dd-diffsplit">
        <div className="dd-diff" ref={scrollRef} data-testid="text-diff" data-mode={mode}>
          {mode === 'side' && (
            <div className="dd-diff-header">
              <div>
                <b>{a?.name}</b>
                {/* Per-side totals, mockup parity: what this side lost, what the
                  other gained. Modified lines appear in the strip's ~ count. */}
                {result.summary.removed > 0 && (
                  <Chip variant="del">－{result.summary.removed}</Chip>
                )}
              </div>
              <div>
                <b>{b?.name}</b>
                {result.summary.added > 0 && <Chip variant="add">＋{result.summary.added}</Chip>}
              </div>
            </div>
          )}

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const { row, dataIndex } = rows[item.index]!;
              return (
                <div
                  key={item.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.kind === 'fold' ? (
                    <button
                      type="button"
                      className="dd-fold"
                      data-testid="fold-row"
                      data-lazy={row.range !== undefined ? 'true' : 'false'}
                      // A capped region (v0.2.8) explains itself and has nothing to
                      // open; a lazy fold past the load cap is in the same position.
                      disabled={row.note !== undefined || !expandable(row)}
                      onClick={() => void openFold(row, dataIndex)}
                    >
                      {foldLabel(row)}
                    </button>
                  ) : (
                    <Row
                      row={row}
                      mode={mode}
                      isCurrent={item.index === currentRowIndex}
                      query={query.trim()}
                      activeHit={activeMatch?.row === item.index ? activeMatch.hit : -1}
                      lang={highlightReady ? lang : undefined}
                      theme={theme}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* v0.2.6: the shared normalisation rules, beside the diff. The text
            engine had no rail of its own before this. The notes join them in
            v0.2.8: the rail already promised an Explain section this view did not
            have, and large-file mode's caps are only honest on screen (Rule 3). */}
        <NormalizeControls
          suppressed={result.summary.suppressed ?? 0}
          notes={result.normalizationNotes}
        />
      </div>
    </div>
  );
}

function Row({
  row,
  mode,
  isCurrent,
  query,
  activeHit,
  lang,
  theme,
}: {
  row: TextRow;
  mode: ViewMode;
  isCurrent: boolean;
  query: string;
  /** Index of the hit *within this row* that search is currently on, or -1. */
  activeHit: number;
  /** Undefined until a grammar is loaded, or for plain text. */
  lang: string | undefined;
  theme: 'dark' | 'light';
}) {
  // A modified row shows two texts; the right side's hits continue the left's
  // numbering so the store's flat match list lines up with what is painted.
  const rightOffset = row.kind === 'mod' ? countMatches(row.text, query) : 0;

  if (mode === 'side') {
    const left =
      row.kind === 'add'
        ? { kind: 'nil' as const, no: undefined, mark: '', text: '' }
        : {
            kind: row.kind === 'mod' ? ('del' as const) : row.kind,
            no: row.left,
            mark: markFor(row.kind, 'left'),
            // `textBefore` is set only on a context row whose sides differ — paired
            // by normalisation. Showing `text` on both sides would display the
            // AFTER line as if it were in the BEFORE file.
            text: row.textBefore ?? row.text,
          };
    const right =
      row.kind === 'del'
        ? { kind: 'nil' as const, no: undefined, mark: '', text: '' }
        : {
            kind: row.kind === 'mod' ? ('add' as const) : row.kind,
            no: row.right,
            mark: markFor(row.kind, 'right'),
            text: row.kind === 'mod' ? (row.textRight ?? '') : row.text,
          };

    return (
      <div className="dd-drow" data-current={isCurrent ? 'true' : undefined}>
        <Cell
          {...left}
          query={query}
          activeHit={activeHit}
          hitOffset={0}
          lang={lang}
          theme={theme}
        />
        <Cell
          {...right}
          query={query}
          activeHit={activeHit}
          hitOffset={rightOffset}
          lang={lang}
          theme={theme}
        />
      </div>
    );
  }

  if (mode === 'inline' && row.kind === 'mod') {
    return (
      <div className="dd-drow" data-current={isCurrent ? 'true' : undefined}>
        {/* `mod`, not `ctx`: this row holds both versions of a changed line, so
            it is neither an addition nor a removal — and tagging it as context
            left the one row that shows a change as the only one with no tint. */}
        <div className="dd-dcell" data-kind="mod">
          <span className="dd-dln">{row.right}</span>
          <span className="dd-dmark">~</span>
          <span className="dd-dtext">
            <Painted
              text={row.text}
              tone="del"
              query={query}
              activeHit={activeHit}
              lang={lang}
              theme={theme}
            />
            <span style={{ color: 'var(--tx-3)' }}> ⇢ </span>
            <Painted
              text={row.textRight ?? ''}
              tone="add"
              query={query}
              activeHit={activeHit}
              hitOffset={rightOffset}
              lang={lang}
              theme={theme}
            />
          </span>
        </div>
      </div>
    );
  }

  // Unified (and inline for non-mod rows): one cell, both line numbers.
  return (
    <div className="dd-drow" data-current={isCurrent ? 'true' : undefined}>
      <div className="dd-dcell" data-kind={row.kind === 'mod' ? 'del' : row.kind}>
        <span className="dd-dln">{row.left ?? ''}</span>
        <span className="dd-dln">{row.right ?? ''}</span>
        <span className="dd-dmark">{markFor(row.kind, 'left')}</span>
        <span className="dd-dtext">
          <Painted
            text={row.text}
            tone={row.kind === 'add' ? 'add' : 'del'}
            query={query}
            activeHit={activeHit}
            lang={lang}
            theme={theme}
          />
        </span>
      </div>
    </div>
  );
}

function Cell({
  kind,
  no,
  mark,
  text,
  query,
  activeHit,
  hitOffset,
  lang,
  theme,
}: {
  kind: TextRow['kind'] | 'nil';
  no: number | undefined;
  mark: string;
  text: string;
  query: string;
  activeHit: number;
  hitOffset: number;
  lang: string | undefined;
  theme: 'dark' | 'light';
}) {
  return (
    <div className="dd-dcell" data-kind={kind}>
      <span className="dd-dln">{no ?? ''}</span>
      <span className="dd-dmark">{mark}</span>
      <span className="dd-dtext">
        <Painted
          text={text}
          tone={kind === 'add' ? 'add' : 'del'}
          query={query}
          activeHit={activeHit}
          hitOffset={hitOffset}
          lang={lang}
          theme={theme}
        />
      </span>
    </div>
  );
}

/**
 * Paints one line: the engine's changed-word marks and the user's search hits,
 * resolved together so a hit inside a changed word keeps both.
 *
 * The common case — no query — short-circuits to the plain mark split, because
 * this runs for every visible row on every frame of a scroll.
 */
function Painted({
  text,
  tone,
  query,
  activeHit,
  hitOffset = 0,
  lang,
  theme,
}: {
  text: string;
  tone: 'add' | 'del';
  query: string;
  activeHit: number;
  hitOffset?: number;
  lang: string | undefined;
  theme: 'dark' | 'light';
}) {
  const tokens = isHighlightable(lang) ? tokenizeLine(stripMarks(text), lang, theme) : [];

  // Nothing to resolve: no query and no grammar. This is the common case for a
  // plain-text diff, and it runs for every visible row on every scroll frame.
  if (query === '' && tokens.length === 0) {
    if (!text.includes(MARK_OPEN)) return <>{text}</>;
    const parts = text.split(new RegExp(`${MARK_OPEN}|${MARK_CLOSE}`));
    return (
      <>
        {parts.map((part, index) =>
          // Odd indices sit between the markers, so they are the changed words.
          index % 2 === 1 ? (
            <span key={index} className="dd-word" data-tone={tone}>
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </>
    );
  }

  return (
    <>
      {segmentRow(text, query, hitOffset, tokens).map((segment, index) => {
        if (!segment.marked && !segment.hit && segment.color === undefined) return segment.text;
        const isCurrentHit = segment.hit && segment.hitIndex === activeHit;
        return (
          <span
            key={index}
            className={segment.marked ? 'dd-word' : undefined}
            data-tone={segment.marked ? tone : undefined}
            data-hit={segment.hit ? 'true' : undefined}
            data-hit-current={isCurrentHit ? 'true' : undefined}
            // The current hit paints its own foreground, so syntax colour yields
            // to it rather than fighting for contrast against the accent.
            style={
              segment.color !== undefined && !isCurrentHit ? { color: segment.color } : undefined
            }
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

/** False for a fold whose lines are neither carried nor small enough to fetch. */
function expandable(row: TextRow): boolean {
  if (row.hidden !== undefined) return true;
  if (row.range === undefined) return false;
  return row.range.end - row.range.start <= MAX_LAZY_BYTES;
}

function foldLabel(row: TextRow): string {
  // A note replaces the label entirely: it is there because a cap was hit, and a
  // cap that renders as an ordinary fold reads as "nothing else changed here".
  if (row.note !== undefined) return `⋯ ${row.note}`;
  const count = (row.count ?? 0).toLocaleString();
  if (!expandable(row)) return `⋯ ${count} unchanged lines — too large to load`;
  return `⋯ ${count} unchanged lines — click to expand`;
}

function markFor(kind: TextRow['kind'], side: 'left' | 'right'): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '−';
  if (kind === 'mod') return side === 'left' ? '−' : '+';
  return '';
}
