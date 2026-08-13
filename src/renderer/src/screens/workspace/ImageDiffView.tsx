import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { DEFAULT_IMAGE_OPTIONS, type ImageDiffOptions } from '../../../../engines/image';
import type { ImageViewData } from '../../lib/imageCompare';
import {
  clampZoom,
  fitZoom,
  isFitZoom,
  scrollForZoom,
  stepZoom,
  zoomPercent,
  type StageBox,
} from '../../lib/imageZoom';
import type { EngineViewProps } from './engineViews';

type Mode = 'side' | 'overlay' | 'blink' | 'difference';

const BLINK_MS = 1100;
/** Pointer travel before a press becomes a pan rather than a click. */
const PAN_THRESHOLD = 3;

/**
 * Zoom held either as "whatever fits" or as a number the user picked.
 *
 * The distinction is the whole trick: while it is `fit`, resizing the window and
 * switching to a single-pane mode re-fit for free, and the moment the user zooms
 * it stops moving under them.
 */
type Zoom = { kind: 'fit' } | { kind: 'manual'; value: number };

/**
 * The stage as a fit has to see it: the padding box **including** the space a
 * scrollbar occupies.
 *
 * Not `clientWidth`, which is the bug this replaces. `clientWidth` excludes a
 * *visible* scrollbar, and above fit there is always one — so pressing Fit from a
 * zoomed-in view measured a stage 15px narrower than the one the panes would
 * actually get, and landed ~2% short of fitting (or jumped, once the bar it no
 * longer needed went away). Invisible on macOS, where scrollbars are overlays and
 * take no space; every CI runner and every Windows or Linux machine sees it, which
 * is how a green local suite sat next to a red `Verify the app boots`.
 *
 * A fitted pane cannot overflow, so the gutter is space the fit is entitled to
 * count — and measuring it this way makes the number the same at every zoom, which
 * is what stops the scrollbar-feedback loop `imageZoom.ts`'s header warns about
 * from running in reverse.
 */
function measureStage(element: HTMLElement): StageBox {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const px = (value: string): number => Number.parseFloat(value) || 0;

  return {
    width: rect.width - px(style.borderLeftWidth) - px(style.borderRightWidth),
    height: rect.height - px(style.borderTopWidth) - px(style.borderBottomWidth),
  };
}

/**
 * The visual comparison (MD §14): four ways of looking at the same two images.
 *
 * Zoom is applied to the *stage*, not to each pane separately, so the region
 * boxes stay pinned to the pixels they describe at any magnification — the trick
 * the approved mockup uses.
 */
export default function ImageDiffView({ result }: EngineViewProps) {
  const data = result.data as ImageViewData;

  const [mode, setMode] = useState<Mode>('side');
  const [zoomState, setZoomState] = useState<Zoom>({ kind: 'fit' });
  const [stage, setStage] = useState<StageBox>({ width: 0, height: 0 });
  const [opacity, setOpacity] = useState(0.5);
  const [showRegions, setShowRegions] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [blinkAfter, setBlinkAfter] = useState(false);
  const [panning, setPanning] = useState(false);
  const [threshold, setThreshold] = useState<number>(
    (useCompareStore.getState().options as Partial<ImageDiffOptions>).threshold ??
      DEFAULT_IMAGE_OPTIONS.threshold,
  );

  const setOptions = useCompareStore((state) => state.setOptions);
  const register = useChangeNavStore((state) => state.register);
  const clearNav = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const committedThreshold = useRef(threshold);

  const paneCount = mode === 'side' ? 2 : 1;
  const measured = stage.width > 0;
  const fit = useMemo(
    () => fitZoom(stage, data.compared, paneCount),
    [stage, data.compared, paneCount],
  );
  const zoom = zoomState.kind === 'fit' ? fit : zoomState.value;
  const atFit = isFitZoom(zoom, fit);

  // Refs as well as values: the wheel listener is attached once, and must not be
  // torn down and rebuilt on every frame of a pinch. `zoomTo` writes the ref
  // itself as well, because wheel events arrive faster than React re-renders and
  // a gesture that kept re-reading the last rendered zoom would crawl.
  const zoomRef = useRef(zoom);
  const fitRef = useRef(fit);
  useEffect(() => {
    zoomRef.current = zoom;
    fitRef.current = fit;
  }, [zoom, fit]);

  /**
   * Zoom about a point, so the pixels under it stay under it. Without the scroll
   * correction, zooming in from a fitted view of a large image lands in the
   * top-left corner and whatever the user was looking at is gone.
   */
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const element = stageRef.current;
    const from = zoomRef.current;
    const value = clampZoom(next, fitRef.current);
    if (value === from) return;

    zoomRef.current = value;
    setZoomState(isFitZoom(value, fitRef.current) ? { kind: 'fit' } : { kind: 'manual', value });

    if (element === null) return;
    const to = scrollForZoom(element, from, value, anchor);
    // Once the browser has laid the panes out at their new size.
    requestAnimationFrame(() => {
      element.scrollLeft = to.left;
      element.scrollTop = to.top;
    });
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => zoomTo(stepZoom(zoomRef.current, direction, fitRef.current)),
    [zoomTo],
  );

  // Each run is a full pixel pass over both images, so the slider settles before
  // it re-runs rather than firing on every frame of a drag.
  useEffect(() => {
    if (threshold === committedThreshold.current) return;
    const timer = setTimeout(() => {
      committedThreshold.current = threshold;
      void setOptions({ threshold });
    }, 250);
    return () => clearTimeout(timer);
  }, [threshold, setOptions]);

  // Blink alternates the two images on a timer; reduced-motion users get the
  // static before image instead of a flashing one.
  useEffect(() => {
    if (mode !== 'blink') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => setBlinkAfter((shown) => !shown), BLINK_MS);
    return () => clearInterval(timer);
  }, [mode]);

  // The stage's own size is what a fit is a fit *to*, so it is measured rather
  // than assumed. The observer fires once on observe, before the first paint,
  // which is why the panes wait for it instead of flashing at 100%.
  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;

    const observer = new ResizeObserver(() => setStage(measureStage(element)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    register(data.regions.length, (index) => {
      const region = data.regions[index];
      const element = stageRef.current;
      if (region === undefined || element === null) return;

      // Regions are percentages of the *compared canvas*, so they resolve
      // against a pane — not against the scroller, which also spans the second
      // pane, the gap and the padding.
      const pane = element.querySelector<HTMLElement>('.dd-shot');
      if (pane === null) return;

      const left = pane.offsetLeft + ((region.left + region.width / 2) / 100) * pane.offsetWidth;
      const top = pane.offsetTop + ((region.top + region.height / 2) / 100) * pane.offsetHeight;

      element.scrollTo({
        left: left - element.clientWidth / 2,
        top: top - element.clientHeight / 2,
        behavior: 'smooth',
      });
    });
    return clearNav;
  }, [register, clearNav, data.regions]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        step(1);
      } else if (event.key === '-') {
        event.preventDefault();
        step(-1);
      } else if (event.key === '0') {
        event.preventDefault();
        // ⌘0 fits, ⌥⌘0 is actual size — ⌘1 is already Go to Compare.
        if (event.altKey) zoomTo(1);
        else setZoomState({ kind: 'fit' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, zoomTo]);

  // ⌘/ctrl-scroll and trackpad pinch, which Chromium delivers as the same event.
  // Attached by hand because it has to be non-passive to preventDefault, and
  // React's onWheel is passive.
  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();

      const box = element.getBoundingClientRect();
      // deltaY arrives in lines or in pixels depending on the device; the
      // exponent keeps either proportional instead of jumping.
      zoomTo(zoomRef.current * Math.exp(-event.deltaY / 320), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  /** Drag to pan, which is what an image viewer is expected to do when zoomed. */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const element = stageRef.current;
    if (element === null || event.button !== 0) return;
    // Nothing to pan: leave the press alone so it stays an ordinary click.
    if (
      element.scrollWidth <= element.clientWidth &&
      element.scrollHeight <= element.clientHeight
    ) {
      return;
    }

    const origin = { x: event.clientX, y: event.clientY };
    const from = { left: element.scrollLeft, top: element.scrollTop };
    let moved = false;

    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      if (!moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setPanning(true);
      }
      element.scrollLeft = from.left - dx;
      element.scrollTop = from.top - dy;
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPanning(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const panes = useMemo(() => {
    const before = { src: data.beforeUrl, size: data.scaled.before };
    const after = { src: data.afterUrl, size: data.scaled.after };

    if (mode === 'difference') {
      return [{ key: 'diff', label: 'Difference', src: data.maskUrl, size: data.compared }];
    }
    if (mode === 'overlay') return [{ key: 'overlay', label: 'Overlay', ...before }];
    if (mode === 'blink') {
      return [
        {
          key: 'blink',
          label: blinkAfter ? 'AFTER' : 'BEFORE',
          ...(blinkAfter ? after : before),
        },
      ];
    }
    return [
      { key: 'before', label: 'BEFORE', ...before },
      { key: 'after', label: 'AFTER', ...after },
    ];
  }, [mode, blinkAfter, data]);

  /**
   * An image takes its own share of the union canvas, anchored top-left — the
   * same place the engine padded it to. Filling the pane instead stretches a
   * smaller image, which reads as a difference that is not there.
   */
  const inUnion = (size: readonly [number, number]): CSSProperties => ({
    width: `${(size[0] / data.compared[0]) * 100}%`,
    height: `${(size[1] / data.compared[1]) * 100}%`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <ToolbarSlot>
        <Seg
          label="Image comparison mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'side', label: 'Side-by-side' },
            { value: 'overlay', label: 'Overlay' },
            { value: 'blink', label: 'Blink' },
            { value: 'difference', label: 'Difference' },
          ]}
        />
        <div className="dd-zoom" data-testid="zoom-controls">
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => step(-1)}>
            −
          </Button>
          <button
            type="button"
            className="dd-zoom-value"
            data-testid="zoom-value"
            data-fit={atFit ? 'true' : 'false'}
            title={atFit ? 'Fitted to the window — click for actual size' : 'Click to fit'}
            onClick={() => (atFit ? zoomTo(1) : setZoomState({ kind: 'fit' }))}
          >
            {atFit && <span className="dd-zoom-tag">Fit</span>}
            {zoomPercent(zoom)}%
          </button>
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => step(1)}>
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Fit both images in the window (⌘0)"
            onClick={() => setZoomState({ kind: 'fit' })}
          >
            Fit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Actual pixel size (⌥⌘0)"
            onClick={() => zoomTo(1)}
          >
            1:1
          </Button>
        </div>
      </ToolbarSlot>

      <div className="dd-imgwrap">
        <div
          className="dd-imgstage"
          ref={stageRef}
          data-testid="image-stage"
          data-mode={mode}
          data-grid={showGrid ? 'true' : 'false'}
          data-panning={panning ? 'true' : 'false'}
          // Fit is by definition the zoom at which everything is on screen, so
          // anything above it is exactly the case where panning has a job.
          data-pannable={zoom > fit ? 'true' : 'false'}
          // Below 1:1 the image is being downsampled, and nearest-neighbour
          // turns a photograph into moiré. Above it, pixels are the point.
          data-smooth={zoom < 1 ? 'true' : 'false'}
          onPointerDown={onPointerDown}
        >
          {measured &&
            panes.map((pane) => (
              <figure
                className="dd-shotwrap"
                key={pane.key}
                data-testid={`pane-${pane.key}`}
                style={{ width: `${data.compared[0] * zoom}px` }}
              >
                <div
                  className="dd-shot"
                  style={{ aspectRatio: `${data.compared[0]} / ${data.compared[1]}` }}
                >
                  <img
                    src={pane.src}
                    alt={pane.label}
                    draggable={false}
                    style={inUnion(pane.size)}
                  />

                  {/* Overlay blends the after image on top of the before one. */}
                  {mode === 'overlay' && (
                    <img
                      className="dd-shot-overlay"
                      src={data.afterUrl}
                      alt="AFTER"
                      draggable={false}
                      style={{ ...inUnion(data.scaled.after), opacity }}
                    />
                  )}

                  {/* Boxes go on the AFTER side only: drawing them twice in
                    side-by-side reads as twice as many changes. */}
                  {showRegions &&
                    pane.key !== 'before' &&
                    mode !== 'difference' &&
                    data.regions.map((region, index) => (
                      <span
                        key={`${region.left}-${region.top}-${index}`}
                        className="dd-region"
                        data-current={index === current ? 'true' : 'false'}
                        style={{
                          left: `${region.left}%`,
                          top: `${region.top}%`,
                          width: `${region.width}%`,
                          height: `${region.height}%`,
                        }}
                      />
                    ))}
                </div>
                <figcaption>{pane.label}</figcaption>
              </figure>
            ))}
        </div>

        <aside className="dd-imgside" data-testid="image-side">
          <div className="dd-opthd">Difference</div>
          <div className="dd-metric">
            <b data-testid="diff-pct">{data.pct.toFixed(2)}%</b>
            <span>
              {data.diffPixels.toLocaleString()} of {data.totalPixels.toLocaleString()} pixels
            </span>
            <div className="dd-metric-bar">
              <i style={{ width: `${Math.min(100, Math.max(data.pct, data.pct > 0 ? 1 : 0))}%` }} />
            </div>
            <div className="dd-metric-dims">
              <Chip>{data.dims.before.join('×')}</Chip>
              <Chip variant={data.sameSize ? 'default' : 'mod'}>{data.dims.after.join('×')}</Chip>
            </div>
          </div>

          <div className="dd-opthd">Match threshold</div>
          <div className="dd-slider">
            <input
              type="range"
              min={1}
              max={50}
              value={Math.round(threshold * 100)}
              aria-label="Match threshold"
              data-testid="threshold"
              onChange={(event) => setThreshold(Number(event.target.value) / 100)}
            />
            <b>{threshold.toFixed(2)}</b>
          </div>

          {mode === 'overlay' && (
            <>
              <div className="dd-opthd">Overlay opacity</div>
              <div className="dd-slider">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity * 100)}
                  aria-label="Overlay opacity"
                  data-testid="opacity"
                  onChange={(event) => setOpacity(Number(event.target.value) / 100)}
                />
                <b>{opacity.toFixed(2)}</b>
              </div>
            </>
          )}

          <div className="dd-opthd">View</div>
          <div className="dd-optrow">
            <Toggle pressed={showRegions} onChange={setShowRegions}>
              Show regions
            </Toggle>
            <Toggle pressed={showGrid} onChange={setShowGrid}>
              Grid
            </Toggle>
          </div>

          <div className="dd-opthd">Changed regions</div>
          <div data-testid="region-list">
            {data.regions.length === 0 && (
              <p className="dd-explain">These images are identical at this threshold.</p>
            )}
            {data.regions.map((region, index) => (
              <button
                type="button"
                key={`${region.left}-${region.top}-${index}`}
                className="dd-regionitem"
                data-current={index === current ? 'true' : 'false'}
                onClick={() => useChangeNavStore.getState().goto(index)}
              >
                <span className="dd-regionswatch" aria-hidden="true" />
                <span className="dd-regionname">
                  {Math.round(region.left)}%, {Math.round(region.top)}%
                </span>
                <span className="dd-regionpct">{region.areaPct.toFixed(2)}%</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
