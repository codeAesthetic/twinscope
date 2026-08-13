import { apiEngine } from './api';
import { binaryEngine } from './binary';
import { csvEngine } from './csv';
import { depsEngine } from './deps';
import { createEnvEngine } from './env';
import { folderEngine } from './folder';
import { gitEngine } from './git';
import { imageEngine } from './image';
import { jsonEngine } from './json';
import { largeTextEngine } from './large';
import { textEngine } from './text';
import { webEngine } from './web';
import { xmlEngine } from './xml';
import { parseYaml, yamlEngine } from './yaml';
import type { DiffEngine } from './types';

/**
 * Every engine the app can run — the four from MD §55, plus `binary` (MVP-11, so
 * an executable stops being line-diffed into mojibake), `git` (v0.2.1) and
 * `yaml` (v0.2.3) and `xml`
 * (v0.2.4) — the JSON core over a different parser each — `csv` (v0.2.5),
 * which is a table and needed a model and a view of its own, `deps` (v0.2.10) and
 * `text-large` (v0.2.8), which is the line diff for files too big to hold, and `api`
 * (v0.3.1) for HARs and OpenAPI contracts.
 *
 * This is the single list the registry reads, and the place a new engine gets
 * added. Options are erased to `unknown` here: callers pick an engine first,
 * then read its own `defaultOptions()` for the concrete shape.
 */
/**
 * The config engine, given the YAML parser v0.2.3 already proved (v0.3.7).
 *
 * Injected rather than imported inside `engines/env/` so that module needs no parser
 * of its own — and so the Kubernetes path reads YAML exactly the way the YAML engine
 * does, merge keys, anchors, multi-document streams and all.
 */
export const envEngine = createEnvEngine((text) => {
  const parsed = parseYaml(text, 'this file');
  return parsed.documents > 1 ? (parsed.value as unknown[]) : [parsed.value];
});

export const ENGINES: readonly DiffEngine<unknown>[] = [
  apiEngine,
  binaryEngine,
  csvEngine,
  depsEngine,
  envEngine,
  folderEngine,
  gitEngine,
  imageEngine,
  jsonEngine,
  largeTextEngine,
  textEngine,
  webEngine,
  xmlEngine,
  yamlEngine,
];
