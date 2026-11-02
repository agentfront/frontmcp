import type * as http from 'node:http';

import express from 'express';

// The `application/json` bodies body-parser's `json()` reads as UTF-8: no charset, or `charset=utf-8`.
const UTF8_JSON_TYPE = /^application\/json(?:; ?charset=utf-8)?$/i;
const FIRST_NON_WHITESPACE = /^[ \t\n\r]*([^ \t\n\r])/;

const isUtf8Json = (req: http.IncomingMessage): boolean => UTF8_JSON_TYPE.test(req.headers['content-type'] ?? '');

// body-parser's `json()` for UTF-8 bodies, read by its `raw()` but decoded without iconv-lite, which loads all its encodings.
export function utf8JsonParser(limit: number | string): express.RequestHandler {
  const readBody = express.raw({ limit, type: isUtf8Json });
  return (req, res, next) => {
    const unparsedBody: unknown = req.body;
    readBody(req, res, (readError?: unknown) => {
      if (readError || req.body === unparsedBody || !Buffer.isBuffer(req.body)) {
        next(readError);
        return;
      }
      const text = decodeUtf8(req.body);
      try {
        req.body = parseStrictJson(text);
      } catch (error) {
        req.body = unparsedBody;
        next(Object.assign(error as SyntaxError, parseFailure(text)));
        return;
      }
      next();
    });
  };
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
