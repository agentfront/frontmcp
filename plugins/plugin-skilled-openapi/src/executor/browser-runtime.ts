import { getRuntimeContext } from '@frontmcp/utils';

/** Whether the server runs in a browser, in a page or a Web Worker: the runtime @frontmcp/utils' browser build reports. */
export function isBrowserRuntime(): boolean {
  return getRuntimeContext().runtime === 'browser';
}

/** Whether the server runs in a browser page, which has the DOM the browser sandbox builds its iframes in. */
export function isBrowserPage(): boolean {
  return isBrowserRuntime() && typeof document !== 'undefined';
}
