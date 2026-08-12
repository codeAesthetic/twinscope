/**
 * Comparison engines — pure logic, no Electron and no DOM.
 *
 * Extracted into a standalone package when the CLI needs it (V1-2); until then
 * a plain directory keeps the build boring (plan D24).
 */
export * from './types';
export * from './detect';
export * from './registry';
