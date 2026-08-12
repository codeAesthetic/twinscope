/// <reference types="vite/client" />
import type { DevDiffApi } from '../../shared/channels';

declare global {
  interface Window {
    /** The preload bridge. The renderer's ONLY route to the rest of the app. */
    devdiff: DevDiffApi;
  }
}

export {};
