import { useState } from 'react';
import {
  RADAR_AXES,
  RADAR_LABELS,
  RADAR_MEANING,
  type RadarAxis,
  type RadarScores,
} from '../../../../engines/radar';

/**
 * The Diff Radar (v0.2.7, MD §21).
 *
 * Geometry ported from the approved mockup (`#radarbox`): centre 112,108, radius 76,
 * axes at `-90 + i·60`, viewBox `-14 0 252 216` so the labels outside the rim are not
 * clipped. Those numbers are the mockup's, not ours to re-derive.
 *
 * The honest part is the **hollow point**. An engine that cannot measure an axis
 * omits it, and an omitted axis is drawn at the centre with an empty ring and named
 * in the legend as not measured — because plotting it at zero would claim that
 * nothing changed there. A comparison of two images has nothing to say about
 * licences, and the chart has to show that difference between "nothing" and
 * "unknown".
 */

const CENTRE = { x: 112, y: 108 };
const RADIUS = 76;

function angleFor(index: number): number {
  return ((-90 + index * 60) * Math.PI) / 180;
}

function pointAt(index: number, factor: number): { x: number; y: number } {
  const angle = angleFor(index);
  return {
    x: CENTRE.x + RADIUS * factor * Math.cos(angle),
    y: CENTRE.y + RADIUS * factor * Math.sin(angle),
  };
}

function ring(factor: number): string {
  return RADAR_AXES.map((_, index) => {
    const point = pointAt(index, factor);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
}

export function DiffRadar({ radar }: { radar: RadarScores }) {
  const [selected, setSelected] = useState<RadarAxis | null>(null);

  const measured = RADAR_AXES.filter((axis) => radar[axis] !== undefined);
  const missing = RADAR_AXES.filter((axis) => radar[axis] === undefined);

  const shape = RADAR_AXES.map((axis, index) => {
    // An unmeasured axis pulls the polygon to the centre rather than to the rim —
    // the shape must not imply a score the engine never gave.
    const point = pointAt(index, (radar[axis] ?? 0) / 100);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="dd-radar" data-testid="diff-radar">
      <svg viewBox="-14 0 252 216" role="img" aria-label="Diff radar">
        <polygon points={ring(1)} className="dd-radar-ring" />
        <polygon points={ring(0.66)} className="dd-radar-ring" data-faint="true" />
        <polygon points={ring(0.33)} className="dd-radar-ring" data-faint="true" />

        {RADAR_AXES.map((axis, index) => {
          const end = pointAt(index, 1);
          return (
            <line
              key={axis}
              className="dd-radar-spoke"
              x1={CENTRE.x}
              y1={CENTRE.y}
              x2={end.x.toFixed(1)}
              y2={end.y.toFixed(1)}
            />
          );
        })}

        <polygon points={shape} className="dd-radar-shape" data-testid="radar-shape" />

        {RADAR_AXES.map((axis, index) => {
          const score = radar[axis];
          const point = pointAt(index, (score ?? 0) / 100);
          return (
            <circle
              key={axis}
              className="dd-radar-dot"
              data-measured={score === undefined ? 'false' : 'true'}
              data-axis={axis}
              data-testid={`radar-dot-${axis}`}
              cx={point.x.toFixed(1)}
              cy={point.y.toFixed(1)}
              r={score === undefined ? 3.5 : 3}
            />
          );
        })}

        {RADAR_AXES.map((axis, index) => {
          const angle = angleFor(index);
          const x = CENTRE.x + (RADIUS + 17) * Math.cos(angle);
          const y = CENTRE.y + (RADIUS + 17) * Math.sin(angle) + 3;
          const anchor =
            Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
          return (
            <text
              key={axis}
              className="dd-radar-label"
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              textAnchor={anchor}
            >
              {RADAR_LABELS[axis]}
            </text>
          );
        })}
      </svg>

      <div className="dd-radar-legend">
        {measured.map((axis) => (
          <button
            key={axis}
            type="button"
            className="dd-radar-key"
            data-selected={selected === axis ? 'true' : 'false'}
            data-testid={`radar-key-${axis}`}
            aria-pressed={selected === axis}
            onClick={() => setSelected(selected === axis ? null : axis)}
          >
            {RADAR_LABELS[axis]} <b>{radar[axis]}</b>
          </button>
        ))}
      </div>

      {missing.length > 0 && (
        <p className="dd-radar-missing" data-testid="radar-missing">
          Not measured by this comparison: {missing.map((axis) => RADAR_LABELS[axis]).join(', ')}.
        </p>
      )}

      {selected !== null && (
        <p className="dd-radar-meaning" data-testid="radar-meaning">
          <b>{RADAR_LABELS[selected]}</b> — {RADAR_MEANING[selected]}
        </p>
      )}
    </div>
  );
}
