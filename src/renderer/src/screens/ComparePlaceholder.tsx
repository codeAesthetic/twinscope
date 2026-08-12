/**
 * Stand-in for the Compare screen. The real drop zones, detection bar and
 * recent list arrive in HOME-2 and HOME-3.
 */
export function ComparePlaceholder() {
  return (
    <div className="dd-placeholder" data-testid="screen-compare">
      <div>
        <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>
          What do you want to compare?
        </p>
        <p style={{ margin: '8px 0 0' }}>Drop zones arrive in HOME-2.</p>
      </div>
    </div>
  );
}
