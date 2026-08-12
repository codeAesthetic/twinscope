/**
 * The ⇄ between the two drop zones, with the mockup's fading guide lines.
 * Static for HOME-2; MVP-2 wires it to swap sides (⌘⇧S).
 */
export function SwapControl() {
  return (
    <div className="dd-swap" data-testid="swap-control">
      <span className="dd-swap-line" aria-hidden="true" />
      <button
        type="button"
        className="dd-swapbtn"
        aria-label="Swap before and after"
        title="Wired up in MVP-2"
      >
        ⇄
      </button>
      <span className="dd-swap-line" aria-hidden="true" />
    </div>
  );
}
