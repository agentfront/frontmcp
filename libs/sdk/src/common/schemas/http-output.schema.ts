// output-schemas.ts
import { z } from 'zod';
import {
  JSONRPCError,
  JSONRPCMessage,
  RequestId,
  JSONRPCResponseSchema,
  JSONRPCErrorSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

/**
 * Constants
 */
export const JSON_RPC = '2.0' as const;
export const REDIRECTS = [301, 302, 303, 307, 308] as const;
export const NO_BODY_STATUSES = [204, 304] as const;

/**
 * Helpers
 */
// numeric-literal union from a readonly tuple of at least TWO numbers (no any)
const zNumUnion = <T extends readonly [number, number, ...number[]]>(vals: T): z.ZodType<T[number]> => {
  let schema: z.ZodType<T[number]> = z.literal(vals[0]) as z.ZodType<T[number]>;
  for (let i = 1; i < vals.length; i++) {
    schema = schema.or(z.literal(vals[i])) as z.ZodType<T[number]>;
  }
  return schema;
};

export const HttpStatus = z.number().int().min(100).max(599);
export const HttpRedirectStatus = zNumUnion(REDIRECTS);
export const HttpEmptyStatus = zNumUnion(NO_BODY_STATUSES);

export const HttpHeaders = z.record(z.union([z.string(), z.union([z.string(), z.array(z.string())])])).default({});

export const HttpCookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  path: z.string().default('/'),
  domain: z.string().optional(),
  httpOnly: z.boolean().default(true),
  secure: z.boolean().optional(),
  sameSite: z.enum(['lax', 'strict', 'none']).optional(),
  maxAge: z.number().int().nonnegative().optional(),
  expires: z.date().optional(),
});
export type HttpCookie = z.infer<typeof HttpCookieSchema>;

export const HttpCookies = z.array(HttpCookieSchema).default([]);

const HttpMeta = z.object({
  headers: HttpHeaders.optional(),
  cookies: HttpCookies.optional(),
});

const statusAllowsBody = (s: number) => !NO_BODY_STATUSES.includes(s as (typeof NO_BODY_STATUSES)[number]);

/**
 * Redirect (3xx)
 */
export const HttpRedirectSchema = z
  .object({
    kind: z.literal('redirect'),
    status: HttpRedirectStatus.default(302),
    location: z.string().url(),
  })
  .merge(HttpMeta);

/**
 * JSON (application/json)
 */
export const HttpJsonSchema = z
  .object({
    kind: z.literal('json'),
    status: HttpStatus.refine((s) => statusAllowsBody(s) && !REDIRECTS.includes(s as (typeof REDIRECTS)[number]), {
      message: 'JSON responses must allow a body and not be a redirect.',
    }),
    body: z.union([z.object({}).passthrough(), z.array(z.any()), z.record(z.string(), z.any())]),
    contentType: z.string().default('application/json; charset=utf-8'),
  })
  .merge(HttpMeta);

/**
 * unknown — plain text, HTML, etc.
 */
export const HttpNextSchema = z
  .object({
    kind: z.literal('next'),
  })
  .passthrough();

export const HttpConsumedSchema = z.object({ kind: z.literal('consumed') });

/**
 * Text (text/*) — plain text, HTML, etc.
 */
export const HttpTextSchema = z
  .object({
    kind: z.literal('text'),
    status: HttpStatus.refine((s) => statusAllowsBody(s) && !REDIRECTS.includes(s as (typeof REDIRECTS)[number]), {
      message: 'Text responses must allow a body and not be a redirect.',
    }),
    body: z.string(),
    contentType: z
      .string()
      .regex(/^text\/[a-z0-9.+-]+/i, 'contentType must be a text/* MIME type')
      .default('text/plain; charset=utf-8'),
  })
  .merge(HttpMeta);

/**
 * HTML (text/html) — convenience specialization of Text
 */
export const HttpHtmlSchema = HttpTextSchema.extend({
  kind: z.literal('html'),
  contentType: z.literal('text/html; charset=utf-8').default('text/html; charset=utf-8'),
});

/**
 * Binary/file (Uint8Array or string with encoding)
 * Works for PDFs, archives, audio, video, etc.
 */
export const HttpBinarySchema = z
  .object({
    kind: z.literal('binary'),
    status: HttpStatus.refine((s) => statusAllowsBody(s) && !REDIRECTS.includes(s as (typeof REDIRECTS)[number]), {
      message: 'Binary responses must allow a body and not be a redirect.',
    }),
    body: z.union([z.instanceof(Uint8Array), z.string()]),
    // how to interpret string body
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
    contentType: z.string().min(1),
    disposition: z.enum(['inline', 'attachment']).default('inline'),
    filename: z.string().optional(),
  })
  .merge(HttpMeta);

/**
 * Images — narrowed binary with common image types
 */
export const HttpImageSchema = HttpBinarySchema.extend({
  kind: z.literal('image'),
  contentType: z.enum([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/avif',
    'image/apng',
    'image/bmp',
    'image/x-icon',
  ]),
});

/**
 * Stream (Readable-like or AsyncIterable) — runtime-agnostic
 */
export type HttpReadableLike = { pipe?: (dest: unknown) => unknown } | AsyncIterable<Uint8Array>;

const isHttpReadableLike = (v: unknown): v is HttpReadableLike => {
  if (typeof v !== 'object' || v === null) return false;
  const maybePipe = (v as { pipe?: unknown }).pipe;
  const maybeAI = (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
  return typeof maybePipe === 'function' || typeof maybeAI === 'function';
};

export const HttpStreamSchema = z
  .object({
    kind: z.literal('stream'),
    status: HttpStatus.refine((s) => statusAllowsBody(s) && !REDIRECTS.includes(s as (typeof REDIRECTS)[number]), {
      message: 'Stream responses must allow a body and not be a redirect.',
    }),
    stream: z.custom<HttpReadableLike>(isHttpReadableLike, 'stream must be a Readable-like or AsyncIterable'),
    contentType: z.string().min(1),
    disposition: z.enum(['inline', 'attachment']).default('inline'),
    filename: z.string().optional(),
  })
  .merge(HttpMeta);

/**
 * Server-Sent Events (specialized stream)
 */
export const HttpSseSchema = HttpStreamSchema.extend({
  kind: z.literal('sse'),
  contentType: z.literal('text/event-stream').default('text/event-stream'),
});

/**
 * JSON-RPC 2.0 wrapped for HTTP union (kind='jsonrpc')
 */
export const HttpJsonRpcSchema = z
  .object({
    kind: z.literal('jsonrpc'),
    status: HttpStatus.refine((s) => statusAllowsBody(s) && !REDIRECTS.includes(s as (typeof REDIRECTS)[number]), {
      message: 'JSON-RPC responses must allow a body and not be a redirect.',
    }),
    contentType: z.string().default('application/json; charset=utf-8'),
    body: z.union([JSONRPCResponseSchema, JSONRPCErrorSchema]),
  })
  .merge(HttpMeta);

/**
 * RFC 7807 Problem Details (application/problem+json)
 */
export const HttpProblemSchema = z
  .object({
    kind: z.literal('problem'),
    status: HttpStatus,
    contentType: z.literal('application/problem+json').default('application/problem+json'),
    body: z
      .object({
        error: z.string(),
      })
      .passthrough(), // allow extension members
  })
  .merge(HttpMeta);

/**
 * Empty responses (204/304) — MUST NOT include a body
 */
export const HttpEmptySchema = z
  .object({
    kind: z.literal('empty'),
    status: HttpEmptyStatus,
  })
  .merge(HttpMeta);

/**
 * Master union — validate all server outputs with this
 */
export const httpOutputSchema = z.discriminatedUnion('kind', [
  HttpRedirectSchema,
  HttpJsonSchema,
  HttpTextSchema,
  HttpHtmlSchema,
  HttpBinarySchema,
  HttpImageSchema,
  HttpStreamSchema,
  HttpSseSchema,
  HttpJsonRpcSchema,
  HttpProblemSchema,
  HttpEmptySchema,
  HttpNextSchema,
  HttpConsumedSchema,
]);

export type HttpOutput = z.infer<typeof httpOutputSchema>;

/**
 * Convenience factories
 */
export const httpRespond = {
  json: <T extends Record<string, any>>(
    body: T,
    extra: Partial<z.infer<typeof HttpJsonSchema>> = {},
  ): z.infer<typeof HttpJsonSchema> => {
    return { kind: 'json', status: 200, body, contentType: 'application/json; charset=utf-8', ...extra };
  },

  ok: (body: string | Record<string, any>): z.infer<typeof HttpJsonSchema> | z.infer<typeof HttpTextSchema> => {
    return typeof body === 'string'
      ? { kind: 'text', status: 200, body, contentType: 'text/plain; charset=utf-8' }
      : { kind: 'json', status: 200, body, contentType: 'application/json; charset=utf-8' };
  },

  unauthorized: (options?: {
    headers?: Record<string, string>;
    body?: Record<string, string>;
    status?: number;
  }): z.infer<typeof HttpJsonSchema> => ({
    kind: 'json',
    status: options?.status ?? 401,
    body: options?.body ?? { error: 'Unauthorized' },
    headers: options?.headers,
    contentType: 'application/json; charset=utf-8',
  }),

  html: (markup: string, status = 200): z.infer<typeof HttpHtmlSchema> => ({
    kind: 'html',
    status,
    body: markup,
    contentType: 'text/html; charset=utf-8',
  }),

  notFound: (message = 'Not Found'): z.infer<typeof HttpTextSchema> => ({
    kind: 'text',
    status: 404,
    body: message,
    contentType: 'text/plain; charset=utf-8',
  }),

  noValidSessionError: (): JSONRPCError => ({
    jsonrpc: JSON_RPC,
    error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
    id: randomUUID(),
  }),

  rpcError: (message: string, requestId?: RequestId | null): z.infer<typeof HttpJsonSchema> => ({
    kind: 'json',
    status: 400,
    contentType: 'application/json; charset=utf-8',
    body: {
      jsonrpc: JSON_RPC,
      error: { code: -32000, message },
      id: requestId ?? randomUUID(),
    },
  }),

  rpcRequest: (requestId: RequestId, method: string, params: any): JSONRPCMessage => ({
    jsonrpc: JSON_RPC,
    id: requestId ?? randomUUID(),
    method,
    params,
  }),
  redirect(location: string): z.infer<typeof HttpRedirectSchema> {
    return {
      kind: 'redirect',
      status: 302,
      location,
    };
  },
  next(extra?: Record<string, any>): z.infer<typeof HttpNextSchema> {
    return { kind: 'next', ...extra };
  },
  consumed(): z.infer<typeof HttpConsumedSchema> {
    return { kind: 'consumed' };
  },
  empty(status: 204 | 304 = 204, headers?: Record<string, string>): z.infer<typeof HttpEmptySchema> {
    return { kind: 'empty', status, headers };
  },
  noContent(headers?: Record<string, string>): z.infer<typeof HttpEmptySchema> {
    return { kind: 'empty', status: 204, headers };
  },
};
