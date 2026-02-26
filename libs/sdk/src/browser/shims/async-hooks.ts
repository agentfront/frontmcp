/**
 * Browser shim for node:async_hooks
 *
 * Exports BrowserContextStorage as AsyncLocalStorage for esbuild alias resolution.
 */

export { BrowserContextStorage as AsyncLocalStorage } from '../../context/context-storage.browser';
