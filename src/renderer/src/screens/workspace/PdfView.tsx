import { useEffect, useMemo, useState } from 'react';
import { NormalizeControls } from '../../components/compare/NormalizeControls';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Chip, Seg } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useSearchStore } from '../../stores/search';
import { MARK_CLOSE, MARK_OPEN } from '../../../../engines/text';
import type { PdfDiffData, PdfPageRow } from '../../../../engines/pdf';
import type { TextRow } from '../../../../engines/text';
import type { EngineViewProps } from './engineViews';

/**
 * PDF comparison (v0.3.3) — a list of pages, each opening onto its own text diff.
 *
 * Pages rather than one long diff, because a PDF *is* pages: "page 7 changed" is the
 * answer, and the lines are the detail behind it. The line rows come from the text
 * engine, so the word-level marks are the same ones the text view paints — rendered
 * here in a compact block rather than through the virtualised list, since a page is
 * forty lines and the pages themselves are what scrolls.
 */
type Filter = 'changed' | 'all';

export default function PdfView({ result }: EngineViewProps) {
  const data = result.data as PdfDiffData;
  const [filter, setFilter] = useState<Filter>('changed');
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    // The first changed page opens by default: a list of collapsed pages with no
    // content visible is a worse first impression than one page of detail.
    const first = data.pages.findIndex((page) => page.state === 'changed');
    return new Set(first === -1 ? [] : [first]);
  });

  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const query = useSearchStore((state) => state.query);
  const enableSearch = useSearchStore((state) => state.enable);
  const disableSearch = useSearchStore((state) => state.disable);

  useEffect(() => {
    enableSearch('Filter pages by their text…');
    return disableSearch;
  }, [enableSearch, disableSearch]);

  const needle = query.trim().toLowerCase();
  const pages = useMemo(
    () =>
      data.pages
        .map((page, index) => ({ page, index }))
        .filter(({ page }) => {
          if (filter === 'changed' && page.state === 'same') return false;
          if (needle === '') return true;
          return page.rows.some((row) => row.text.toLowerCase().includes(needle));
        }),
    [data.pages, filter, needle],
  );

  useEffect(() => {
    register(pages.length, (index) => {
      const target = pages[index];
      if (target === undefined) return;
      document
        .querySelector(`[data-pdfpage="${target.index}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return clearNav;
  }, [register, clearNav, pages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Show"
          value={filter}
          onChange={(next) => setFilter(next)}
          options={[
            { value: 'changed', label: 'Changed pages' },
            { value: 'all', label: `All (${data.pages.length})` },
          ]}
        />
        <Chip variant="info">
          {data.counts.before} → {data.counts.after} pages
        </Chip>
        {data.imageOnly > 0 && (
          <Chip variant="mod" data-testid="pdf-image-only">
            {data.imageOnly} with no text
          </Chip>
        )}
      </ToolbarSlot>

      <div className="dd-diffsplit">
        <div className="dd-envscroll" data-testid="pdf-view">
          {data.infoChanges.length > 0 && (
            <table className="dd-envtable" data-testid="pdf-metadata">
              <thead>
                <tr>
                  <th>Metadata</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {data.infoChanges.map((change) => (
                  <tr key={change.key} data-state="changed">
                    <td className="dd-envkey">{change.key}</td>
                    <td className="dd-envold">{change.before ?? '—'}</td>
                    <td className="dd-envnew">{change.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {pages.map(({ page, index }) => (
            <Page
              key={index}
              page={page}
              index={index}
              open={open.has(index)}
              onToggle={() =>
                setOpen((previous) => {
                  const next = new Set(previous);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            />
          ))}

          {pages.length === 0 && (
            <p className="dd-empty" data-testid="pdf-empty">
              {data.pages.every((page) => page.state === 'same')
                ? 'Every page has the same text.'
                : 'Nothing matches that filter.'}
            </p>
          )}
        </div>

        <NormalizeControls
          suppressed={result.summary.suppressed ?? 0}
          notes={result.normalizationNotes}
        />
      </div>
    </div>
  );
}

function Page({
  page,
  index,
  open,
  onToggle,
}: {
  page: PdfPageRow;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label =
    page.state === 'added'
      ? `Page ${page.after} — added`
      : page.state === 'removed'
        ? `Page ${page.before} — removed`
        : page.before === page.after
          ? `Page ${page.before}`
          : `Page ${page.before} → ${page.after}`;

  return (
    <section
      className="dd-apientry"
      data-pdfpage={index}
      data-state={page.state}
      data-testid={`pdf-page-${index}`}
    >
      <button type="button" className="dd-apihead" onClick={onToggle} aria-expanded={open}>
        <span className="dd-apitwisty" aria-hidden="true">
          {page.rows.length === 0 ? '·' : open ? '▾' : '▸'}
        </span>
        <span className="dd-apipath">{label}</span>
        <span className="dd-apichips">
          {page.added > 0 && <Chip variant="add">＋{page.added}</Chip>}
          {page.removed > 0 && <Chip variant="del">－{page.removed}</Chip>}
          {page.modified > 0 && <Chip variant="mod">～{page.modified}</Chip>}
          {page.resized !== undefined && (
            <Chip variant="info">
              {page.resized.before.join('×')} → {page.resized.after.join('×')} pt
            </Chip>
          )}
          {/* A page with no extractable text is a scan or one big image, and a text
              comparison has nothing to say about it — better said than implied. */}
          {(page.characters.before === 0 || page.characters.after === 0) &&
            page.state !== 'added' &&
            page.state !== 'removed' && <Chip variant="mod">no text</Chip>}
          {page.state === 'same' && <Chip>same</Chip>}
        </span>
      </button>

      {open && page.rows.length > 0 && (
        <div className="dd-pdflines">
          {page.rows.map((row, at) => (
            <Line key={at} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One line of a page's diff. The marks are the text engine's `⟦…⟧`. */
function Line({ row }: { row: TextRow }) {
  if (row.kind === 'fold') {
    return <div className="dd-pdfline" data-kind="fold">{`⋯ ${row.count} unchanged lines`}</div>;
  }

  return (
    <div className="dd-pdfline" data-kind={row.kind}>
      <span className="dd-pdfnum">{row.left ?? ''}</span>
      <span className="dd-pdfnum">{row.right ?? ''}</span>
      <span className="dd-pdfmark">
        {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : row.kind === 'mod' ? '~' : ''}
      </span>
      <span className="dd-pdftext">
        <Marked text={row.textBefore ?? row.text} />
        {row.kind === 'mod' && (
          <>
            <span style={{ color: 'var(--tx-3)' }}> ⇢ </span>
            <Marked text={row.textRight ?? ''} tone="add" />
          </>
        )}
      </span>
    </div>
  );
}

function Marked({ text, tone = 'del' }: { text: string; tone?: 'add' | 'del' }) {
  if (!text.includes(MARK_OPEN)) return <>{text}</>;
  const parts = text.split(new RegExp(`${MARK_OPEN}|${MARK_CLOSE}`));
  return (
    <>
      {parts.map((part, index) =>
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
