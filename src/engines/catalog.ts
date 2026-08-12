import { binaryEngine } from './binary';
import { folderEngine } from './folder';
import { imageEngine } from './image';
import { jsonEngine } from './json';
import { textEngine } from './text';
import type { DiffEngine } from './types';

/**
 * Every engine the app can run — the four from MD §55 plus `binary`, which
 * MVP-11 added so an executable stops being line-diffed into mojibake.
 *
 * This is the single list the registry reads, and the place a new engine gets
 * added. Options are erased to `unknown` here: callers pick an engine first,
 * then read its own `defaultOptions()` for the concrete shape.
 */
export const ENGINES: readonly DiffEngine<unknown>[] = [
  binaryEngine,
  folderEngine,
  imageEngine,
  jsonEngine,
  textEngine,
];
