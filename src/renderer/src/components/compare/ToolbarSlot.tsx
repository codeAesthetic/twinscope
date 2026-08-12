import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lets an engine view render controls into the workspace toolbar.
 *
 * A portal rather than a registry entry: the view already knows what its
 * controls are and holds their state, so shipping them as a second lazy
 * component would only split one concern across two files.
 */
const ToolbarSlotContext = createContext<HTMLElement | null>(null);

export function ToolbarSlotProvider({
  element,
  children,
}: {
  element: HTMLElement | null;
  children: ReactNode;
}) {
  return <ToolbarSlotContext.Provider value={element}>{children}</ToolbarSlotContext.Provider>;
}

export function ToolbarSlot({ children }: { children: ReactNode }) {
  const element = useContext(ToolbarSlotContext);
  // Null on the first render, before the toolbar has mounted its slot.
  if (element === null) return null;
  return createPortal(children, element);
}
