import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { Button, Chip, Seg, Toggle } from '../../components/primitives';
import { useChangeNavStore } from '../../stores/changeNav';
import { useCompareStore } from '../../stores/compare';
import { DEFAULT_IMAGE_OPTIONS, type ImageDiffOptions } from '../../../../engines/image';
import type { ImageViewData } from '../../lib/imageCompare';
import type { EngineViewProps } from './engineViews';

type Mode = 'side' | 'overlay' | 'blink' | 'difference';

const BLINK_MS = 1100;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

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
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(0.5);
  const [showRegions, setShowRegions] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [blinkAfter, setBlinkAfter] = useState(false);
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

  useEffect(() => {
    register(data.regions.length, (index) => {
      const region = data.regions[index];
      const stage = stageRef.current;
      if (region === undefined || stage === null) return;
      // Bring the region roughly to the middle of the viewport.
      stage.scrollTo({
        left: (region.left / 100) * stage.scrollWidth - stage.clientWidth / 2,
        top: (region.top / 100) * stage.scrollHeight - stage.clientHeight / 2,
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
        setZoom((value) => Math.min(ZOOM_MAX, value * 1.25));
      } else if (event.key === '-') {
        event.preventDefault();
        setZoom((value) => Math.max(ZOOM_MIN, value / 1.25));
      } else if (event.key === '0') {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const panes = useMemo(() => {
    if (mode === 'difference') return [{ key: 'diff', label: 'Difference', src: data.maskUrl }];
    if (mode === 'overlay') return [{ key: 'overlay', label: 'Overlay', src: data.beforeUrl }];
    if (mode === 'blink') {
      return [
        {
          key: 'blink',
          label: blinkAfter ? 'AFTER' : 'BEFORE',
          src: blinkAfter ? data.afterUrl : data.beforeUrl,
        },
      ];
    }
    return [
      { key: 'before', label: 'BEFORE', src: data.beforeUrl },
      { key: 'after', label: 'AFTER', src: data.afterUrl },
    ];
  }, [mode, blinkAfter, data]);

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
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / 1.25))}
          >
            −
          </Button>
          <button type="button" className="dd-zoom-value" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * 1.25))}
          >
            +
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
            Fit
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
        >
          {panes.map((pane) => (
            <figure
              className="dd-shotwrap"
              key={pane.key}
              data-testid={`pane-${pane.key}`}
              style={{ width: `${data.compared[0] * zoom}px` }}
            >
              <div className="dd-shot">
                <img src={pane.src} alt={pane.label} draggable={false} />

                {/* Overlay blends the after image on top of the before one. */}
                {mode === 'overlay' && (
                  <img
                    className="dd-shot-overlay"
                    src={data.afterUrl}
                    alt="AFTER"
                    draggable={false}
                    style={{ opacity }}
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
