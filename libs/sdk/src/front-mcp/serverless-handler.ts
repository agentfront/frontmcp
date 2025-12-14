/**
 * Global handler registry for serverless deployments.
 * The @FrontMcp decorator stores the handler here when running in serverless mode.
 */

let globalHandler: unknown = null;
let globalHandlerPromise: Promise<unknown> | null = null;
let globalHandlerError: Error | null = null;

/**
 * Store the serverless handler (called by decorator after handler is ready)
 */
export function setServerlessHandler(handler: unknown): void {
  globalHandler = handler;
}

/**
 * Store the promise that resolves to the handler (called by decorator immediately)
 */
export function setServerlessHandlerPromise(promise: Promise<unknown>): void {
  globalHandlerPromise = promise;
}

/**
 * Store an error that occurred during handler initialization
 */
export function setServerlessHandlerError(error: Error): void {
  globalHandlerError = error;
}

/**
 * Get the serverless handler synchronously.
 * Returns null if handler is not ready yet.
 * @throws Error if handler initialization failed
 */
export function getServerlessHandler(): unknown {
  if (globalHandlerError) {
    throw globalHandlerError;
  }
  return globalHandler;
}

/**
 * Get the serverless handler asynchronously.
 * Waits for the handler to be ready if needed.
 * @throws Error if handler initialization failed or not initialized
 */
export async function getServerlessHandlerAsync(): Promise<unknown> {
  if (globalHandlerError) {
    throw globalHandlerError;
  }
  if (globalHandlerPromise) {
    return globalHandlerPromise;
  }
  if (!globalHandler) {
    throw new Error(
      'Serverless handler not initialized. Ensure @FrontMcp decorator ran and FRONTMCP_SERVERLESS=1 is set.',
    );
  }
  return globalHandler;
}
