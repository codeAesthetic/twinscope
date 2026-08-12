import { useEffect, useRef, useState } from 'react';
import { Button, Kbd } from '../primitives';
import { Toast } from '../Toast';
import { useCompareStore } from '../../stores/compare';
import type { ImageViewData } from '../../lib/imageCompare';
import type { ReportPayload } from '../../../../shared/channels';

type Format = 'html' | 'md' | 'patch';

const FORMATS: Array<{ value: Format; label: string; detail: string }> = [
  { value: 'html', label: 'HTML report', detail: 'Self-contained, opens in any browser' },
  { value: 'md', label: 'Markdown', detail: 'For pull requests and tickets' },
  { value: 'patch', label: 'Unified patch', detail: 'Copy to clipboard' },
];

const LAST_FORMAT_KEY = 'devdiff.lastExportFormat';

/**
 * Export (MD §38/§39).
 *
 * The rendering happens in main from the same `shared/report` modules the CLI
 * will use; this only decides what to send. ⌘⇧E repeats the last format, which
 * is what turns exporting into a reflex rather than a menu hunt.
 */
export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; path: string | null } | null>(null);
  const result = useCompareStore((state) => state.result);
  const a = useCompareStore((state) => state.a);
  const b = useCompareStore((state) => state.b);
  const options = useCompareStore((state) => state.options);
  const busy = useRef(false);

  const exportAs = async (format: Format): Promise<void> => {
    setOpen(false);
    if (result === null || a === null || b === null || busy.current) return;
    busy.current = true;

    try {
      localStorage.setItem(LAST_FORMAT_KEY, format);

      const payload: ReportPayload = {
        a: { name: a.name, kind: a.kind, ...(a.path !== undefined ? { path: a.path } : {}) },
        b: { name: b.name, kind: b.kind, ...(b.path !== undefined ? { path: b.path } : {}) },
        engineId: result.engineId,
        summary: result.summary,
        options,
        normalizationNotes: result.normalizationNotes,
        generatedAt: new Date().toISOString(),
        data: result.data,
        ...(result.engineId === 'image' ? { images: imagesFrom(result.data) } : {}),
      };

      // The patch format is a clipboard action, not a file: pasting a diff into
      // a review comment is the whole use case.
      if (format === 'patch') {
        const { renderUnifiedPatch } = await import('../../../../shared/report/markdown');
        await window.devdiff.clipboard.write(
          renderUnifiedPatch(payload as Parameters<typeof renderUnifiedPatch>[0]),
        );
        setToast({ message: 'Patch copied to clipboard', path: null });
        return;
      }

      const saved = await window.devdiff.report.save(format, payload);
      if (saved.path !== null) setToast({ message: 'Report saved', path: saved.path });
    } catch (cause) {
      setToast({
        message: `Export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        path: null,
      });
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        const last = localStorage.getItem(LAST_FORMAT_KEY);
        void exportAs(last === 'md' || last === 'patch' ? last : 'html');
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <>
      <Button data-testid="export-button" onClick={() => setOpen((value) => !value)}>
        Export ▾ <Kbd>⌘⇧E</Kbd>
      </Button>

      {open && (
        <>
          <div className="dd-menu-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="dd-menu dd-export-menu" role="menu" data-testid="export-menu">
            {FORMATS.map((format) => (
              <button
                type="button"
                role="menuitem"
                key={format.value}
                className="dd-export-item"
                data-testid={`export-${format.value}`}
                onClick={() => void exportAs(format.value)}
              >
                <span className="dd-export-label">{format.label}</span>
                <span className="dd-export-detail">{format.detail}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {toast !== null && (
        <Toast
          message={toast.message}
          testId="export-toast"
          onDismiss={() => setToast(null)}
          action={
            toast.path !== null ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="reveal-report"
                onClick={() => void window.devdiff.report.reveal(toast.path as string)}
              >
                Reveal
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}

/** The image view keeps its images as blob/data URLs on the result itself. */
function imagesFrom(data: unknown): ReportPayload['images'] {
  const image = data as Partial<ImageViewData>;
  return {
    ...(image.beforeUrl !== undefined ? { before: image.beforeUrl } : {}),
    ...(image.afterUrl !== undefined ? { after: image.afterUrl } : {}),
    ...(image.maskUrl !== undefined ? { mask: image.maskUrl } : {}),
  };
}
