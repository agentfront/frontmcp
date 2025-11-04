// utils/with-response-handler.ts

import { ServerRequest, ServerRequestHandler, ServerResponse } from '@frontmcp/sdk';

type Runner<T> = (req: ServerRequest) => Promise<T> | T;
type SuccessWriter<T> = (res: ServerResponse, result: T) => void | Promise<void>;
type ErrorWriter = (res: ServerResponse, err: any) => void | Promise<void>;

export function withResponseHandler<T>(runner: Runner<T>) {
  let onSuccess: SuccessWriter<T> = (res, result) => {
    throw new Error('No success writer set');
  };

  let onError: ErrorWriter = (res, err) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    const code = err?.code ?? 'server_error';
    const message = typeof err?.message === 'string' ? err.message : 'internal error';
    res.status(status);
    res.setHeader('Content-Type', 'application/json');
    res.json({ error: code, message });
  };

  const builder = {
    /** Set the success writer; chainable. */
    success(fn: SuccessWriter<T>) {
      onSuccess = fn;
      return builder;
    },

    /**
     * Set the error writer and finalize into a ServerHookHandler.
     * Calling this returns the Express-like/host handler.
     */
    fail(fn: ErrorWriter): ServerRequestHandler {
      onError = fn;
      const handler: ServerRequestHandler = async (req, res) => {
        try {
          const result = await Promise.resolve(runner(req));
          await onSuccess(res, result as T);
        } catch (err: any) {
          await onError(res, err);
        }
      };
      return handler;
    },

    /**
     * If you prefer not to end with .fail(), you can call .build() after setting .success().
     * It will use the default error writer unless overridden via .fail() earlier.
     */
    build(): ServerRequestHandler {
      const handler: ServerRequestHandler = async (req, res) => {
        try {
          const result = await Promise.resolve(runner(req));
          await onSuccess(res, result as T);
        } catch (err: any) {
          await onError(res, err);
        }
      };
      return handler;
    },
  };

  return builder;
}
