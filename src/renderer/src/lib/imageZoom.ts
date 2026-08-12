/**
 * Zoom arithmetic for the image viewer, kept out of the component so it can be
 * tested without a DOM.
 *
 * The layout constants have to agree with `styles/image.css`. A fit that forgets
 * the stage padding or the caption produces a pane very slightly too big for the
 * stage — which is the one result "fit" must never produce, because the
 * scrollbar it summons then changes the size it was measured against.
 */

/** `.dd-imgstage` padding. */
export const STAGE_PADDING = 20;
/** `.dd-imgstage` gap, between the two side-by-side panes. */
export const PANE_GAP = 18;
/** `figcaption`: 7px margin over an 10.5px/1 line. */
export const CAPTION_BLOCK = 18;

/**
 * The ladder the − / + buttons walk. Multiplying by 1.25 instead gives 80%,
 * then 64%, then 51.2% — arithmetically fine and unreadable in a label.
 * The current fit is spliced in at runtime, so stepping out of a fitted view
 * always passes back through it.
 */
export const ZOOM_STOPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.66, 1, 1.5, 2, 3, 4];
export const ZOOM_MAX = 4;
/** At 1% a 4096px canvas is 41px wide. Nothing below this is a view of anything. */
export const ZOOM_HARD_FLOOR = 0.01;

const EPSILON = 0.0005;

export interface StageBox {
  width: number;
  height: number;
}

/** How much of the stage the panes may actually occupy. */
function usable(stage: StageBox, panes: number): StageBox {
  return {
    width: stage.width - STAGE_PADDING * 2 - PANE_GAP * (panes - 1),
    height: stage.height - STAGE_PADDING * 2 - CAPTION_BLOCK,
  };
}

/**
 * The zoom at which every pane fits the stage at once.
 *
 * Capped at 1: a 16×16 favicon blown up to fill the window is not what anyone
 * means by fitting it, and "fit" that magnifies makes the ladder confusing in
 * both directions.
 */
export function fitZoom(
  stage: StageBox,
  compared: readonly [number, number],
  panes: number,
): number {
  const [width, height] = compared;
  if (width <= 0 || height <= 0) return 1;

  const room = usable(stage, panes);
  if (room.width <= 0 || room.height <= 0) return ZOOM_HARD_FLOOR;

  const zoom = Math.min(room.width / (panes * width), room.height / height);
  return Math.min(1, Math.max(ZOOM_HARD_FLOOR, zoom));
}

/**
 * The floor for a given fit. A flat minimum is the bug this replaces: 25% of a
 * 4000px pair is 2000px of pane in a ~900px stage, so the user could not reach
 * a view of both images however many times they clicked.
 */
export function minZoom(fit: number): number {
  return Math.max(ZOOM_HARD_FLOOR, Math.min(ZOOM_STOPS[0] as number, fit));
}

/** The ladder for this fit: the fixed stops, plus fit, in order, deduplicated. */
export function zoomStops(fit: number): number[] {
  const floor = minZoom(fit);
  const all = [...ZOOM_STOPS, fit].filter((stop) => stop >= floor - EPSILON && stop <= ZOOM_MAX);
  return [...new Set(all.map((stop) => Number(stop.toFixed(4))))].sort((a, b) => a - b);
}

/** One click of − (`direction: -1`) or + (`direction: 1`). */
export function stepZoom(current: number, direction: 1 | -1, fit: number): number {
  const stops = zoomStops(fit);
  if (direction === 1) {
    return stops.find((stop) => stop > current + EPSILON) ?? ZOOM_MAX;
  }
  return [...stops].reverse().find((stop) => stop < current - EPSILON) ?? (stops[0] as number);
}

/** For continuous zoom (wheel, pinch), which has no stops to land on. */
export function clampZoom(value: number, fit: number): number {
  return Math.min(ZOOM_MAX, Math.max(minZoom(fit), value));
}

export function isFitZoom(value: number, fit: number): boolean {
  return Math.abs(value - fit) < EPSILON;
}

/** Never "0%" — a label that reads as no zoom at all when the view is fine. */
export function zoomPercent(zoom: number): number {
  return Math.max(1, Math.round(zoom * 100));
}

export interface ScrollBox {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Where to scroll so that the point under `anchor` stays under `anchor` across a
 * zoom change. Without this, zooming in from a fitted view jumps to the
 * top-left corner — which on a large image means the change you were looking at
 * leaves the screen.
 *
 * `anchor` is in client coordinates within the scroller; the default is its
 * centre, which is what the toolbar buttons and the keyboard want. The wheel
 * handler passes the cursor instead.
 *
 * Exact while the content overflows in that axis. It cannot be exact while the
 * content is smaller than the stage, because the stage centres it — but then
 * there is nothing to scroll, so the error is unobservable.
 */
export function scrollForZoom(
  box: ScrollBox,
  from: number,
  to: number,
  anchor?: { x: number; y: number },
): { left: number; top: number } {
  if (from <= 0) return { left: box.scrollLeft, top: box.scrollTop };

  const at = anchor ?? { x: box.clientWidth / 2, y: box.clientHeight / 2 };
  const ratio = to / from;

  return {
    left: Math.max(0, (box.scrollLeft + at.x) * ratio - at.x),
    top: Math.max(0, (box.scrollTop + at.y) * ratio - at.y),
  };
}
