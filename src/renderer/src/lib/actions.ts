import { useCallback } from 'react';
import { useIntake } from './intake';
import { useRunComparison } from './compareClient';
import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';
import { useTheme } from '../theme/ThemeProvider';

/**
 * What each shortcut id actually does (MD §10).
 *
 * Separate from the registry so the table stays declarative, and separate from
 * the palette so both drive the same implementations — a command that behaves
 * differently depending on how it was invoked is the bug this prevents.
 */
export function useActions(): (id: string) => void {
  const { fromClipboard } = useIntake();
  const runComparison = useRunComparison();
  const setInput = useCompareStore((state) => state.setInput);
  const swap = useCompareStore((state) => state.swap);
  const setView = useAppStore((state) => state.setView);
  const { toggle } = useTheme();

  return useCallback(
    (id: string) => {
      switch (id) {
        case 'open-files':
          void pickPair('pickFile', setInput);
          return;
        case 'open-folders':
          void pickPair('pickFolder', setInput);
          return;
        case 'paste-compare':
          void fromClipboard();
          return;
        case 'swap':
          swap();
          return;
        case 'theme':
          toggle();
          return;
        case 'settings':
          setView('settings');
          return;
        case 'view-compare':
          setView('compare');
          return;
        case 'view-history':
          setView('history');
          return;
        case 'run':
          void runComparison();
          return;
        default:
          // 'export', 'search' and the view-local bindings are owned by the
          // surfaces that can actually perform them.
          window.dispatchEvent(new CustomEvent('devdiff:action', { detail: id }));
      }
    },
    [fromClipboard, runComparison, setInput, swap, setView, toggle],
  );
}

/**
 * Opens the picker twice — once per side.
 *
 * Sequential rather than parallel: two native dialogs at once is a mess, and
 * "choose the BEFORE file, then the AFTER file" is the order the titles already
 * promise.
 */
async function pickPair(
  method: 'pickFile' | 'pickFolder',
  setInput: ReturnType<typeof useCompareStore.getState>['setInput'],
): Promise<void> {
  const a = await window.devdiff.dialog[method]('A');
  if (a === null) return;
  setInput('A', a);

  const b = await window.devdiff.dialog[method]('B');
  if (b !== null) setInput('B', b);
}
