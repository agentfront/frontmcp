// What an Express app does around the handlers, for the node:http host (#948): `res.status()`, `res.send()` and
// `res.json()` (weak ETag, 304 on a fresh conditional GET, Content-Length, no body for HEAD), the final 404 and error
// page (the `finalhandler` package), and the helpers they use. Each follows the Express major version installed, which
// the host passes in as `flavor`; `res.redirect()` borrows Express's own, loaded the first time a handler redirects.
import { createHash } from 'node:crypto';
import * as http from 'node:http';

import { toLocationHeader } from '../../../utils/http-location.utils';
import { parseRequestUrl } from './request-url';
import type { NativeRequest, NativeResponse, NextFunction } from './router';

export interface ExpressFlavor {
  /** The installed Express major version: 4 or 5. */
  major: 4 | 5;
}

// --- bytes.parse() ---------------------------------------------------------------------------------------------------

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1 << 10,
  mb: 1 << 20,
  gb: 1 << 30,
  tb: Math.pow(1024, 4),
  pb: Math.pow(1024, 5),
};
const BYTES_PATTERN = /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|pb)$/i;

/** A body limit as body-parser reads one (the `bytes` package): `'4mb'`, `'512kb'`, a number, or null. */
export function parseBytes(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value !== 'string') return null;
  const results = BYTES_PATTERN.exec(value);
  let floatValue: number;
  let unit = 'b';
  if (!results) {
    floatValue = parseInt(value, 10);
  } else {
    floatValue = parseFloat(results[1]);
    unit = results[4].toLowerCase();
  }
  if (isNaN(floatValue)) return null;
  return Math.floor(BYTE_UNITS[unit] * floatValue);
}

/** body-parser's limit option: a number as is, anything else through `bytes`, `'100kb'` when unset. */
export function bodyParserLimit(limit: number | string | undefined): number | null {
  return typeof limit !== 'number' ? parseBytes(limit || '100kb') : limit;
}

// --- on-finished -----------------------------------------------------------------------------------------------------

/** Whether the request has been read to its end, or can no longer be read (on-finished's `isFinished`). */
export function isRequestFinished(req: http.IncomingMessage): boolean {
  const socket = req.socket;
  return Boolean(
    (req as { upgrade?: boolean }).upgrade || !socket || !socket.readable || (req.complete && !req.readable),
  );
}

/** Calls `listener` once the request has been read, or its socket fails or closes (on-finished). */
export function onRequestFinished(req: http.IncomingMessage, listener: () => void): void {
  if (isRequestFinished(req)) {
    setImmediate(listener);
    return;
  }
  let done = false;
  const socket = req.socket;
  const finish = (): void => {
    if (done) return;
    done = true;
    req.removeListener('end', finish);
    req.removeListener('finish', finish);
    socket?.removeListener('error', finish);
    socket?.removeListener('close', finish);
    listener();
  };
  req.on('end', finish);
  req.on('finish', finish);
  socket?.on('error', finish);
  socket?.on('close', finish);
}

// --- escape-html, etag, fresh ----------------------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' };

export function escapeHtml(value: string): string {
  return String(value).replace(/["&'<>]/g, (char) => HTML_ESCAPES[char]);
}

const EMPTY_BODY_TAG = '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';

/** Express's default (weak) ETag of a response body. */
export function weakEntityTag(body: Buffer): string {
  if (body.length === 0) return `W/${EMPTY_BODY_TAG}`;
  const hash = createHash('sha1').update(body).digest('base64').substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

const CACHE_CONTROL_NO_CACHE = /(?:^|,)\s*?no-cache\s*?(?:,|$)/;

function parseTokenList(value: string): string[] {
  let end = 0;
  const list: string[] = [];
  let start = 0;
  for (let i = 0, len = value.length; i < len; i++) {
    switch (value.charCodeAt(i)) {
      case 0x20:
        if (start === end) start = end = i + 1;
        break;
      case 0x2c:
        list.push(value.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  }
  list.push(value.substring(start, end));
  return list;
}

function parseHttpDate(date: string | undefined): number {
  const timestamp = date && Date.parse(date);
  return typeof timestamp === 'number' ? timestamp : NaN;
}

/** `req.fresh`: a GET or HEAD whose conditional headers match the response about to be sent (the `fresh` package). */
export function isFresh(req: NativeRequest, res: http.ServerResponse): boolean {
  const method = req.method;
  const status = res.statusCode;
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!((status >= 200 && status < 300) || status === 304)) return false;
  const modifiedSince = req.headers['if-modified-since'];
  const noneMatch = req.headers['if-none-match'];
  if (!modifiedSince && !noneMatch) return false;
  const cacheControl = req.headers['cache-control'];
  if (cacheControl && CACHE_CONTROL_NO_CACHE.test(cacheControl)) return false;
  if (noneMatch && noneMatch !== '*') {
    const etag = res.getHeader('ETag') as string | undefined;
    if (!etag) return false;
    let etagStale = true;
    for (const match of parseTokenList(noneMatch)) {
      if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
        etagStale = false;
        break;
      }
    }
    if (etagStale) return false;
  }
  if (modifiedSince) {
    const lastModified = res.getHeader('Last-Modified') as string | undefined;
    const modifiedStale = !lastModified || !(parseHttpDate(lastModified) <= parseHttpDate(modifiedSince));
    if (modifiedStale) return false;
  }
  return true;
}

// --- res.status(), res.send(), res.json() ----------------------------------------------------------------------------

const CHARSET_PARAM = /;\s*charset\s*=/;

/** The charset `res.set('Content-Type', type)` adds to a type without one. */
function defaultCharset(type: string): string | undefined {
  return /^text\/|^application\/(javascript|json)/.test(type) ? 'utf-8' : undefined;
}

/** `res.set('Content-Type', value)`. */
function setContentType(res: http.ServerResponse, value: string): void {
  let type = value;
  if (!CHARSET_PARAM.test(type)) {
    const charset = defaultCharset(type.split(';')[0]);
    if (charset) type += '; charset=' + charset;
  }
  res.setHeader('Content-Type', type);
}

/** `res.type('html' | 'bin' | 'txt')` as `res.send()` calls it. */
const SEND_TYPES = { html: 'text/html', bin: 'application/octet-stream', txt: 'text/plain' } as const;

/** Express's `setCharset(type, 'utf-8')`: the type with its charset parameter replaced. */
function withUtf8Charset(type: string): string {
  // A peer dependency of the SDK, loaded on first use
  const contentType = require('content-type') as typeof import('content-type');
  const parsed = contentType.parse(type);
  parsed.parameters['charset'] = 'utf-8';
  return contentType.format(parsed);
}

export function status(res: http.ServerResponse, code: number, flavor: ExpressFlavor): void {
  if (flavor.major >= 5) {
    if (!Number.isInteger(code)) {
      throw new TypeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be an integer.`);
    }
    if (code < 100 || code > 999) {
      throw new RangeError(
        `Invalid status code: ${JSON.stringify(code)}. Status code must be greater than 99 and less than 1000.`,
      );
    }
  }
  res.statusCode = code;
}

export function send(req: NativeRequest, res: NativeResponse, body: unknown, flavor: ExpressFlavor): void {
  let chunk: unknown = body;
  let encoding: BufferEncoding | undefined;

  if (typeof chunk === 'number' && flavor.major < 5) {
    if (!res.getHeader('Content-Type')) setContentType(res, SEND_TYPES.txt);
    res.statusCode = chunk;
    chunk = http.STATUS_CODES[chunk];
  }

  switch (typeof chunk) {
    case 'string':
      if (!res.getHeader('Content-Type')) setContentType(res, SEND_TYPES.html);
      break;
    case 'boolean':
    case 'number':
    case 'object':
      if (chunk === null) {
        chunk = '';
      } else if (flavor.major >= 5 ? ArrayBuffer.isView(chunk) : Buffer.isBuffer(chunk)) {
        // Express 5 sends any typed array or DataView as bytes; Express 4 only a Buffer
        if (!res.getHeader('Content-Type')) setContentType(res, SEND_TYPES.bin);
      } else {
        json(req, res, chunk, flavor);
        return;
      }
      break;
  }

  if (typeof chunk === 'string') {
    encoding = 'utf8';
    const type = res.getHeader('Content-Type');
    if (typeof type === 'string') setContentType(res, withUtf8Charset(type));
  }

  const generateETag = !res.getHeader('ETag');
  let length: number | undefined;
  if (chunk !== undefined) {
    if (Buffer.isBuffer(chunk)) {
      length = chunk.length;
    } else {
      chunk = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk as Uint8Array);
      encoding = undefined;
      length = (chunk as Buffer).length;
    }
    res.setHeader('Content-Length', String(length));
  }

  if (generateETag && length !== undefined) {
    res.setHeader('ETag', weakEntityTag(chunk as Buffer));
  }

  if (isFresh(req, res)) res.statusCode = 304;

  if (res.statusCode === 204 || res.statusCode === 304) {
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.removeHeader('Transfer-Encoding');
    chunk = '';
  }

  if (res.statusCode === 205) {
    res.setHeader('Content-Length', '0');
    res.removeHeader('Transfer-Encoding');
    chunk = '';
  }

  if (req.method === 'HEAD') res.end();
  else res.end(chunk as Buffer | string, encoding as BufferEncoding);
}

export function json(req: NativeRequest, res: NativeResponse, value: unknown, flavor: ExpressFlavor): void {
  const body = JSON.stringify(value);
  if (!res.getHeader('Content-Type')) setContentType(res, 'application/json');
  send(req, res, body, flavor);
}

// --- res.redirect() --------------------------------------------------------------------------------------------------

/**
 * `res.redirect()`: Express negotiates the body with the request's Accept header, so the first redirect loads Express
 * and runs its own `res.redirect()` on the request, as an Express app's response would.
 */
export function redirect(req: NativeRequest, res: NativeResponse, args: [number | string, string?]): void {
  // Loaded only when a handler redirects
  const express = require('express') as typeof import('express');
  const app = expressRedirectApp(express);
  Object.setPrototypeOf(req, app.request);
  Object.setPrototypeOf(res, app.response);
  (res.redirect as (...redirectArgs: unknown[]) => void)(...args);
}

let redirectApp: import('express').Express | undefined;

function expressRedirectApp(express: typeof import('express')): import('express').Express {
  if (!redirectApp) {
    redirectApp = express();
    redirectApp.disable('x-powered-by');
  }
  return redirectApp;
}

// --- finalhandler ----------------------------------------------------------------------------------------------------

function createHtmlDocument(message: string): string {
  const body = escapeHtml(message)
    .replace(/\n/g, '<br>')
    .replace(/\x20{2}/g, ' &nbsp;');
  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>Error</title>\n' +
    '</head>\n' +
    '<body>\n' +
    '<pre>' +
    body +
    '</pre>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

function errorStatusCode(err: { status?: unknown; statusCode?: unknown }): number | undefined {
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 600) return err.status;
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) return err.statusCode;
  return undefined;
}

function errorMessage(err: { stack?: string; toString?: () => string }, status: number, env: string): string {
  let message: string | undefined;
  if (env !== 'production') {
    message = err.stack;
    if (!message && typeof err.toString === 'function') message = err.toString();
  }
  return message || (http.STATUS_CODES[status] as string);
}

function resourceName(req: NativeRequest): string {
  try {
    const original = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
    return String(parseRequestUrl({ url: original })?.pathname);
  } catch {
    return 'resource';
  }
}

/**
 * The end of an Express app's stack: a 404 page when nothing answered, an error page (with the stack outside
 * production) when a handler failed, and the error logged as Express logs it.
 */
export function finalHandler(req: NativeRequest, res: NativeResponse, env: string): NextFunction {
  return (err?: unknown) => {
    let headers: Record<string, unknown> | undefined;
    let message: string;
    let statusCode: number;

    if (!err && res.headersSent) return;

    if (err) {
      const error = err as { status?: unknown; statusCode?: unknown; headers?: unknown; stack?: string };
      const errorStatus = errorStatusCode(error);
      if (errorStatus === undefined) {
        statusCode =
          typeof res.statusCode !== 'number' || res.statusCode < 400 || res.statusCode > 599 ? 500 : res.statusCode;
      } else {
        statusCode = errorStatus;
        if (error.headers && typeof error.headers === 'object')
          headers = { ...(error.headers as Record<string, unknown>) };
      }
      message = errorMessage(error as { stack?: string }, statusCode, env);
    } else {
      statusCode = 404;
      message = 'Cannot ' + req.method + ' ' + toLocationHeader(resourceName(req));
    }

    if (err && env !== 'test') {
      setImmediate(() => console.error((err as { stack?: string }).stack || String(err)));
    }

    if (res.headersSent) {
      req.socket?.destroy();
      return;
    }

    const write = (): void => {
      const body = createHtmlDocument(message);
      res.statusCode = statusCode;
      if (req.httpVersionMajor < 2) res.statusMessage = http.STATUS_CODES[statusCode] as string;
      res.removeHeader('Content-Encoding');
      res.removeHeader('Content-Language');
      res.removeHeader('Content-Range');
      for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value as string);
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(body, 'utf8');
    };

    if (isRequestFinished(req)) {
      write();
      return;
    }
    req.unpipe();
    onRequestFinished(req, write);
    req.resume();
  };
}

// --- the automatic OPTIONS response ----------------------------------------------------------------------------------

export function sendOptions(req: NativeRequest, res: NativeResponse, methods: string[], flavor: ExpressFlavor): void {
  if (flavor.major >= 5) {
    const allow = [...new Set(methods)].sort().join(', ');
    res.setHeader('Allow', allow);
    res.setHeader('Content-Length', Buffer.byteLength(allow));
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(allow);
    return;
  }
  const allow = [...new Set(methods)].join(',');
  res.setHeader('Allow', allow);
  send(req, res, allow, flavor);
}
