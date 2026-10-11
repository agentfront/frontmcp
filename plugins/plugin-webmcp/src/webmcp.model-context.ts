import type { ModelContext } from './webmcp.types';

/** `document.modelContext` in a browser that implements WebMCP (or has a polyfill installed). */
export function resolveDocumentModelContext(): ModelContext | undefined {
  const modelContext = (globalThis as { document?: { modelContext?: unknown } }).document?.modelContext;
  return typeof modelContext === 'object' &&
    modelContext !== null &&
    typeof (modelContext as ModelContext).registerTool === 'function'
    ? (modelContext as ModelContext)
    : undefined;
}

/** Whether this page can register WebMCP tools (`document.modelContext.registerTool` exists). */
export function isWebMcpSupported(): boolean {
  return resolveDocumentModelContext() !== undefined;
}
