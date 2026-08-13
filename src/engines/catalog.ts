import { binaryEngine } from './binary';
import { csvEngine } from './csv';
import { depsEngine } from './deps';
import { folderEngine } from './folder';
import { gitEngine } from './git';
import { imageEngine } from './image';
import { jsonEngine } from './json';
import { textEngine } from './text';
import { xmlEngine } from './xml';
import { yamlEngine } from './yaml';
import type { DiffEngine } from './types';

/**
 * Every engine the app can run — the four from MD §55, plus `binary` (MVP-11, so
 * an executable stops being line-diffed into mojibake), `git` (v0.2.1) and
 * `yaml` (v0.2.3) and `xml`
 * (v0.2.4) — the JSON core over a different parser each — `csv` (v0.2.5),
 * which is a table and needed a model and a view of its own, and `deps` (v0.2.10).
 *
 * This is the single list the registry reads, and the place a new engine gets
 * added. Options are erased to `unknown` here: callers pick an engine first,
 * then read its own `defaultOptions()` for the concrete shape.
 */
export const ENGINES: readonly DiffEngine<unknown>[] = [
  binaryEngine,
  csvEngine,
  depsEngine,
  folderEngine,
  gitEngine,
  imageEngine,
  jsonEngine,
  textEngine,
  xmlEngine,
  yamlEngine,
];
