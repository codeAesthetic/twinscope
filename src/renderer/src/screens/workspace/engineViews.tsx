import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { CompareResult } from '../../stores/compare';

/**
 * What every engine view receives. Deliberately small: a view gets the result
 * and nothing else, and reaches the chassis through the change-nav store and
 * the toolbar slot rather than through props.
 */
export interface EngineViewProps {
  result: CompareResult;
}

/**
 * engineId → view, code-split.
 *
 * Each engine's view is lazy so the text engine's highlighter and the image
 * engine's canvas work never load for a comparison that does not need them
 * (MD §30). Missing entries fall back to a plain summary, which is how an engine
 * can ship its logic before its view exists.
 */
export const ENGINE_VIEWS: Record<string, LazyExoticComponent<ComponentType<EngineViewProps>>> = {
  demo: lazy(() => import('./DemoResultView')),
  text: lazy(() => import('./TextDiffView')),
  json: lazy(() => import('./JsonTreeView')),
  // YAML is the JSON core over a different parser (v0.2.3), so it is the same
  // view — registered against the same module rather than through a wrapper file,
  // which would cost a second lazy chunk for no difference in what it renders.
  yaml: lazy(() => import('./JsonTreeView')),
  folder: lazy(() => import('./FolderTreeView')),
  git: lazy(() => import('./GitDiffView')),
  image: lazy(() => import('./ImageDiffView')),
  binary: lazy(() => import('./BinaryView')),
};

export function engineViewFor(
  engineId: string,
): LazyExoticComponent<ComponentType<EngineViewProps>> | undefined {
  return ENGINE_VIEWS[engineId];
}
