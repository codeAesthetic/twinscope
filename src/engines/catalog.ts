import { binaryEngine } from './binary';
import { folderEngine } from './folder';
import { gitEngine } from './git';
import { imageEngine } from './image';
import { jsonEngine } from './json';
import { textEngine } from './text';
import { yamlEngine } from './yaml';
import type { DiffEngine } from './types';

/**
 * Every engine the app can run — the four from MD §55, plus `binary` (MVP-11, so
 * an executable stops being line-diffed into mojibake), `git` (v0.2.1) and
 * `yaml` (v0.2.3, which is the JSON core over a different parser).
 *
 * This is the single list the registry reads, and the place a new engine gets
 * added. Options are erased to `unknown` here: callers pick an engine first,
 * then read its own `defaultOptions()` for the concrete shape.
 */
export const ENGINES: readonly DiffEngine<unknown>[] = [
  binaryEngine,
  folderEngine,
  gitEngine,
  imageEngine,
  jsonEngine,
  textEngine,
  yamlEngine,
];
