import type * as http from 'node:http';

import type { ServerRequest } from '../../common';

type Next = (err?: unknown) => void;

/** A body-parser middleware: reads the body it matches into `req.body`, then calls `next`. */
export type BodyReader = (req: http.IncomingMessage, res: http.ServerResponse, next: Next) => void;

const FIRST_NON_WHITESPACE = /^[ \t\n\r]*([^ \t\n\r])/;

/**
 * body-parser's `json()` for UTF-8 bodies, read by `readBody` (its `raw()`, or the node:http host's) but decoded
 * without iconv-lite, which loads all its encodings.
 */
export function utf8JsonParserWith(readBody: BodyReader): BodyReader {
  return (req, res, next) => {
    const request = req as http.IncomingMessage & { body?: unknown };
    const unparsedBody: unknown = request.body;
    readBody(req, res, (readError?: unknown) => {
      if (readError || request.body === unparsedBody || !Buffer.isBuffer(request.body)) {
        next(readError);
        return;
      }
      const text = decodeUtf8(request.body);
      keepBodyBytes(req, res, request.body);
      try {
        request.body = parseStrictJson(text);
      } catch (error) {
        request.body = unparsedBody;
        next(Object.assign(error as SyntaxError, parseFailure(text)));
        return;
      }
      next();
    });
  };
}

// body-parser's `verify` hook: keeps the bytes it read as `ServerRequest.bodyBytes`.
export function keepBodyBytes(req: http.IncomingMessage, _res: http.ServerResponse, bytes: Buffer): void {
  (req as ServerRequest).bodyBytes = bytes;
}

// What http-errors' `createError(400, error, { body, type })` adds, in its order.
const parseFailure = (body: string) => ({
  expose: true,
  statusCode: 400,
  status: 400,
  body,
  type: 'entity.parse.failed',
});

// iconv-lite decodes UTF-8 with Node's StringDecoder and drops a leading byte order mark.
function decodeUtf8(body: Buffer): string {
  const text = body.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseStrictJson(text: string): unknown {
  if (text.length === 0) return {};
  const first = FIRST_NON_WHITESPACE.exec(text)?.[1];
  if (first !== '{' && first !== '[') throw strictSyntaxError(text, first);
  return JSON.parse(text);
}

// body-parser's strict-mode error: what JSON.parse says about the text with everything from its first character masked.
function strictSyntaxError(text: string, first: string | undefined): SyntaxError {
  const index = first === undefined ? -1 : text.indexOf(first);
  const error = jsonParseError(index === -1 ? '' : text.slice(0, index).padEnd(text.length, '#'));
  const message = error.message.replace(/#+/g, (mask) => text.substring(index, index + mask.length));
  error.stack = error.stack?.replace(error.message, message);
  error.message = message;
  return error;
}

function jsonParseError(invalidJson: string): SyntaxError {
  try {
    JSON.parse(invalidJson);
  } catch (error) {
    return error as SyntaxError;
  }
  return new SyntaxError(`Expected invalid JSON: ${invalidJson}`);
}
