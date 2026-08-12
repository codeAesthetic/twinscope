import type { FileKind } from '../primitives';

/**
 * Presentational view-model for a filled drop zone.
 *
 * Deliberately not the engine's `InputRef`: this screen is still static, and
 * MVP-2 will map real inputs onto this shape rather than the reverse.
 */
export interface DropZoneInput {
  kind: FileKind;
  name: string;
  /** Right-hand detail line, e.g. "41.2 KB · json". */
  meta: string;
  /** First few lines of content, or a summary for folders. Max 4 shown. */
  preview: string[];
}
