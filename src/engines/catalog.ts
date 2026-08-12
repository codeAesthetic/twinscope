import { folderEngine } from './folder';
import { imageEngine } from './image';
import { jsonEngine } from './json';
import { textEngine } from './text';
import type { DiffEngine } from './types';

/**
 * The four MVP engines (MD §55: start with exactly these).
 *
 * All four are real now — text (MVP-4), json (MVP-5), folder (MVP-6) and image
 * (MVP-7). The file remains the single list the registry reads, and the place a
 * fifth engine gets added.
 *
 * Options are erased to `unknown` here: callers pick an engine first, then read
 * its own `defaultOptions()` for the concrete shape.
 */
export const ENGINES: readonly DiffEngine<unknown>[] = [
  folderEngine,
  imageEngine,
  jsonEngine,
  textEngine,
];
