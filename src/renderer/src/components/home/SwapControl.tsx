/**
 * The ⇄ between the two drop zones, with the mockup's fading guide lines.
 * Inert without `onSwap`, which is how the `#gallery` renders it.
 */
export function SwapControl({ onSwap }: { onSwap?: () => void }) {
  return (
    <div className="dd-swap" data-testid="swap-control">
      <span className="dd-swap-line" aria-hidden="true" />
      <button
        type="button"
        className="dd-swapbtn"
        aria-label="Swap before and after"
        data-testid="swap-button"
        {...(onSwap ? { onClick: onSwap } : { title: 'Wired up in MVP-2' })}
      >
        ⇄
      </button>
      <span className="dd-swap-line" aria-hidden="true" />
    </div>
  );
}
