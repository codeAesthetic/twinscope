import { useEffect, useRef, useState } from 'react';
import { Toggle } from '../../components/primitives';
import { ToolbarSlot } from '../../components/compare/ToolbarSlot';
import { useChangeNavStore } from '../../stores/changeNav';
import type { EngineViewProps } from './engineViews';

/**
 * The demo engine's result view — the reference implementation of the engine
 * view contract, written before any real engine so MVP-4..7 have something to
 * copy.
 *
 * It demonstrates the three things a view owes the chassis:
 *  1. register a change count and a way to reveal one change,
 *  2. render its own toolbar controls through `<ToolbarSlot>`,
 *  3. otherwise stay ignorant of the frame around it.
 */
export default function DemoResultView({ result }: EngineViewProps) {
  const [showNotes, setShowNotes] = useState(true);
  const register = useChangeNavStore((state) => state.register);
  const clear = useChangeNavStore((state) => state.clear);
  const current = useChangeNavStore((state) => state.current);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  const total = result.summary.added + result.summary.removed + result.summary.modified;

  useEffect(() => {
    register(total, (index) => {
      rowRefs.current[index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return clear;
  }, [register, clear, total]);

  return (
    <div style={{ width: '100%', maxWidth: 720, textAlign: 'left' }} data-testid="demo-result-view">
      <ToolbarSlot>
        <Toggle pressed={showNotes} onChange={setShowNotes}>
          Show notes
        </Toggle>
      </ToolbarSlot>

      <p style={{ margin: '0 0 12px', color: 'var(--tx-2)', fontSize: 12.5 }}>
        Compared in {result.ms} ms — {total} synthetic changes. A real engine view replaces this
        from MVP-4.
      </p>

      <ol
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
        data-testid="demo-change-list"
        aria-label="Changes"
      >
        {Array.from({ length: total }, (_, index) => (
          <li
            key={index}
            ref={(node) => {
              rowRefs.current[index] = node;
            }}
            data-testid={`demo-change-${index}`}
            aria-current={current === index ? 'true' : undefined}
            style={{
              padding: '7px 10px',
              borderLeft: `2px solid ${current === index ? 'var(--acc)' : 'transparent'}`,
              background: current === index ? 'var(--acc-bg)' : 'transparent',
              color: current === index ? 'var(--tx)' : 'var(--tx-2)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
            }}
          >
            change {index + 1}
          </li>
        ))}
      </ol>

      {showNotes && result.normalizationNotes.length > 0 && (
        <ul
          data-testid="normalization-notes"
          style={{
            margin: '14px 0 0',
            padding: 0,
            listStyle: 'none',
            color: 'var(--tx-3)',
            fontSize: 11.5,
          }}
        >
          {result.normalizationNotes.map((note) => (
            <li key={note}>· {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
