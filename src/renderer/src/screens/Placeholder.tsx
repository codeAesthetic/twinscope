/** Empty-state stand-in for screens whose content lands in HOME-4. */
export function Placeholder({ name, note }: { name: string; note: string }) {
  return (
    <div className="dd-placeholder" data-testid={`screen-${name.toLowerCase()}`}>
      <div>
        <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: 15, fontWeight: 600 }}>{name}</p>
        <p style={{ margin: '8px 0 0' }}>{note}</p>
      </div>
    </div>
  );
}
