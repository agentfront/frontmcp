/**
 * Type declarations for react-dom/static (React 19).
 *
 * The prerender API is available in React 19 for static HTML generation.
 * These types are provided here as they may not be in @types/react-dom yet.
 */

declare module 'react-dom/static' {
  import type { ReactNode } from 'react';

  interface PrerenderOptions {
    identifierPrefix?: string;
    namespaceURI?: string;
    nonce?: string;
    bootstrapScriptContent?: string;
    bootstrapScripts?: string[];
    bootstrapModules?: string[];
    progressiveChunkSize?: number;
    signal?: AbortSignal;
    onError?: (error: Error) => void;
  }

  interface PrerenderResult {
    prelude: ReadableStream<Uint8Array>;
  }

  /**
   * Pre-render a React tree to a static HTML stream.
   * Unlike renderToString, this waits for all Suspense boundaries.
   */
  export function prerender(children: ReactNode, options?: PrerenderOptions): Promise<PrerenderResult>;

  /**
   * Pre-render a React tree to a static HTML stream for browser environments.
   */
  export function prerenderToNodeStream(children: ReactNode, options?: PrerenderOptions): Promise<PrerenderResult>;
}
