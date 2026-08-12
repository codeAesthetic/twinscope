import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { MARK_CLOSE, MARK_OPEN, type TextDiffData, type TextRow } from '../../../../engines/text';
import type { EngineViewProps } from './engineViews';

type ViewMode = 'side' | 'unified' | 'inline';

const ROW_HEIGHT = 20;

/**
 * The text/code diff (MD §8.1): side-by-side, unified and inline, virtualised.
 *
 * One virtualised list of row *pairs* rather than two scrolling columns — that
 * way the sides cannot drift out of alignment and there is no scroll to
 * synchronise.
 */
export default function TextDiffView({ result }: EngineViewProps) {
  const data = result.data as TextDiffData;
  const [mode, setMode] = useState<ViewMode>('side');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  /** Rows with expanded folds spliced in, and one row per line in unified. */
  const rows = useMemo(() => {
    const out: TextRow[] = [];
    data.rows.forEach((row, index) => {
      if (row.kind === 'fold' && expanded.has(index)) {
        out.push(...(row.hidden ?? []));
        return;
      }
      out.push(row);
    });
    return out;
  }, [data.rows, expanded]);

  /** Indices of navigable changes, in document order. */
  const changeRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.kind !== 'ctx' && row.kind !== 'fold'),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

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

  const copyChangedLines = async (): Promise<void> => {
    const text = rows
      .filter((row) => row.kind === 'add' || row.kind === 'mod')
      .map((row) => strip(row.kind === 'mod' ? (row.textRight ?? '') : row.text))
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
          pressed={expanded.size > 0}
          onChange={(next) =>
            setExpanded(
              next
                ? new Set(data.rows.map((row, index) => (row.kind === 'fold' ? index : -1)))
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

      <div className="dd-diff" ref={scrollRef} data-testid="text-diff" data-mode={mode}>
        {mode === 'side' && (
          <div className="dd-diff-header">
            <div>
              <b>{a?.name}</b>
            </div>
            <div>
              <b>{b?.name}</b>
            </div>
          </div>
        )}

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
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
                    onClick={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        next.add(item.index);
                        return next;
                      })
                    }
                  >
                    ⋯ {row.count} unchanged lines — click to expand
                  </button>
                ) : (
                  <Row row={row} mode={mode} isCurrent={item.index === currentRowIndex} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ row, mode, isCurrent }: { row: TextRow; mode: ViewMode; isCurrent: boolean }) {
  if (mode === 'side') {
    const left =
      row.kind === 'add'
        ? { kind: 'nil' as const, no: undefined, mark: '', text: '' }
        : {
            kind: row.kind === 'mod' ? ('del' as const) : row.kind,
            no: row.left,
            mark: markFor(row.kind, 'left'),
            text: row.text,
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
        <Cell {...left} />
        <Cell {...right} />
      </div>
    );
  }

  if (mode === 'inline' && row.kind === 'mod') {
    return (
      <div className="dd-drow" data-current={isCurrent ? 'true' : undefined}>
        <div className="dd-dcell" data-kind="ctx">
          <span className="dd-dln">{row.right}</span>
          <span className="dd-dmark">~</span>
          <span className="dd-dtext">
            <Marked text={row.text} tone="del" />
            <span style={{ color: 'var(--tx-3)' }}> ⇢ </span>
            <Marked text={row.textRight ?? ''} tone="add" />
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
          <Marked text={row.text} tone={row.kind === 'add' ? 'add' : 'del'} />
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
}: {
  kind: TextRow['kind'] | 'nil';
  no: number | undefined;
  mark: string;
  text: string;
}) {
  return (
    <div className="dd-dcell" data-kind={kind}>
      <span className="dd-dln">{no ?? ''}</span>
      <span className="dd-dmark">{mark}</span>
      <span className="dd-dtext">
        <Marked text={text} tone={kind === 'add' ? 'add' : 'del'} />
      </span>
    </div>
  );
}

/** Renders ⟦…⟧ marks as highlighted spans. */
function Marked({ text, tone }: { text: string; tone: 'add' | 'del' }) {
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

function markFor(kind: TextRow['kind'], side: 'left' | 'right'): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '−';
  if (kind === 'mod') return side === 'left' ? '−' : '+';
  return '';
}

function strip(text: string): string {
  return text.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
}
