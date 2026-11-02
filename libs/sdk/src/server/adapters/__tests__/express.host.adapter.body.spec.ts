import * as http from 'node:http';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

import type express from 'express';

import { ExpressHostAdapter } from '../express.host.adapter';

// Mock base.host.adapter to break the import chain into ../../common (which pulls @frontmcp/auth)
jest.mock('../base.host.adapter', () => {
  class HostServerAdapter {}
  return { HostServerAdapter };
});

type BodyRequest = {
  contentType?: string;
  contentEncoding?: string;
  body: Buffer;
  chunked?: boolean;
};

type Answer = { status: number; contentType?: string; body: string };

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ERROR_PAGE = (message: string) =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>${message}</pre>\n</body>\n</html>\n`;
const TOO_LARGE = (length?: number) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Payload Too Large', data: { limit: 1024, length } },
  });

const send = (url: string, request: BodyRequest): Promise<Answer> => {
  const { hostname, port, pathname } = new URL(url);
  const headers: Record<string, string | number> = {};
  if (request.contentType) headers['content-type'] = request.contentType;
  if (request.contentEncoding) headers['content-encoding'] = request.contentEncoding;
  if (!request.chunked) headers['content-length'] = request.body.length;
  return new Promise((resolve, reject) => {
    const req = http.request({ agent: false, method: 'POST', hostname, port, path: pathname, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    if (request.chunked) {
      for (const byte of request.body) req.write(Buffer.from([byte]));
    } else {
      req.write(request.body);
    }
    req.end();
  });
};

const startServer = async (
  extend?: (app: express.Application) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const adapter = new ExpressHostAdapter({ bodyLimit: '1kb' });
  adapter.registerRoute('POST', '/echo', (req: unknown, res: unknown) => {
    const body = (req as { body: unknown }).body;
    (res as express.Response).json({ body: body === undefined ? '<undefined>' : body });
  });
  const app = adapter.getHandler();
  app.set('env', 'production');
  extend?.(app);
  const server = http.createServer(app as http.RequestListener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/echo`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

const text = (body: string, contentType = 'application/json'): BodyRequest => ({
  contentType,
  body: Buffer.from(body),
});

const REQUESTS: Record<string, BodyRequest> = {
  'a JSON object': text('{"a":1,"b":[true,null,"x"]}'),
  'charset=utf-8': text('{"word":"caf\u00e9 \u{1f600}"}', 'application/json; charset=utf-8'),
  'charset=UTF-8 without a space': text('{"a":1}', 'application/json;charset=UTF-8'),
  'a quoted charset': text('{"a":1}', 'application/json; charset="utf-8"'),
  'an upper-case type': text('{"a":1}', 'APPLICATION/JSON'),
  'a byte order mark': { contentType: 'application/json', body: Buffer.concat([BOM, Buffer.from('{"a":1}')]) },
  'two byte order marks': { contentType: 'application/json', body: Buffer.concat([BOM, BOM, Buffer.from('{"a":1}')]) },
  'whitespace before an array': text(' \n\t[1,2]'),
  'an empty body': text(''),
  'only whitespace': text('  \n'),
  'a string literal': text('"text"'),
  'a number literal': text('42'),
  'a true literal': text('true'),
  'a bare word': text(' x{}'),
  'a truncated object': text('{"a":'),
  'an unquoted key': text('{a:1}'),
  'trailing garbage': text('{"a":1}x'),
  'a __proto__ key': text('{"__proto__":{"polluted":true}}'),
  'invalid UTF-8 inside a string': {
    contentType: 'application/json',
    body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xe2, 0x82, 0x22, 0x7d]),
  },
  'a continuation byte first': { contentType: 'application/json', body: Buffer.from([0x80, 0x7b, 0x7d]) },
  'multibyte characters one byte per chunk': {
    contentType: 'application/json',
    body: Buffer.from('{"word":"\u00e9\u20ac\u{1f600}"}'),
    chunked: true,
  },
  'charset=utf-16le': {
    contentType: 'application/json; charset=utf-16le',
    body: Buffer.from('{"word":"caf\u00e9"}', 'utf16le'),
  },
  'charset=latin1': text('{"a":1}', 'application/json; charset=latin1'),
  'charset=utf8': text('{"a":1}', 'application/json; charset=utf8'),
  'charset=utf-9': text('{"a":1}', 'application/json; charset=utf-9'),
  'a parameter other than charset': text('{"a":1}', 'application/json; foo=bar'),
  'a +json suffix type': text('[1]', 'application/json-patch+json'),
  'a vendor +json type': text('[1]', 'application/vnd.api+json'),
  'JSON listed with text': text('{"a":1}', 'application/json, text/plain'),
  'JSON listed with a form': text('a=1', 'application/json, application/x-www-form-urlencoded'),
  'a form': text('a=1&b[c]=2', 'application/x-www-form-urlencoded'),
  'text/plain': text('{"a":1}', 'text/plain'),
  'no content type': { body: Buffer.from('{"a":1}') },
  gzip: { contentType: 'application/json', contentEncoding: 'gzip', body: gzipSync('{"a":1}') },
  deflate: { contentType: 'application/json', contentEncoding: 'deflate', body: deflateSync('{"a":1}') },
  brotli: { contentType: 'application/json', contentEncoding: 'br', body: brotliCompressSync('{"a":1}') },
  'corrupt gzip': { contentType: 'application/json', contentEncoding: 'gzip', body: Buffer.from('{"a":1}') },
  'an unsupported encoding': { contentType: 'application/json', contentEncoding: 'compress', body: Buffer.from('{}') },
  'a body at the limit': text(`{"a":"${'x'.repeat(1016)}"}`),
  'a body over the limit': text(`{"a":"${'x'.repeat(1017)}"}`),
  'a chunked body over the limit': {
    contentType: 'application/json',
    body: Buffer.from(`{"a":"${'x'.repeat(1017)}"}`),
    chunked: true,
  },
  'gzip that inflates over the limit': {
    contentType: 'application/json',
    contentEncoding: 'gzip',
    body: gzipSync(`{"a":"${'x'.repeat(4096)}"}`),
  },
};

const echo = (body: unknown): Answer => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ body }),
});
const errorPage = (status: number, message: string): Answer => ({
  status,
  contentType: 'text/html; charset=utf-8',
  body: ERROR_PAGE(message),
});
const tooLarge = (length?: number): Answer => ({
  status: 413,
  contentType: 'application/json; charset=utf-8',
  body: TOO_LARGE(length),
});

const ANSWERS: Record<string, Answer> = {
  'a JSON object': echo({ a: 1, b: [true, null, 'x'] }),
  'charset=utf-8': echo({ word: 'caf\u00e9 \u{1f600}' }),
  'charset=UTF-8 without a space': echo({ a: 1 }),
  'a quoted charset': echo({ a: 1 }),
  'an upper-case type': echo({ a: 1 }),
  'a byte order mark': echo({ a: 1 }),
  'two byte order marks': errorPage(400, 'Bad Request'),
  'whitespace before an array': echo([1, 2]),
  'an empty body': echo({}),
  'only whitespace': errorPage(400, 'Bad Request'),
  'a string literal': errorPage(400, 'Bad Request'),
  'a number literal': errorPage(400, 'Bad Request'),
  'a true literal': errorPage(400, 'Bad Request'),
  'a bare word': errorPage(400, 'Bad Request'),
  'a truncated object': errorPage(400, 'Bad Request'),
  'an unquoted key': errorPage(400, 'Bad Request'),
  'trailing garbage': errorPage(400, 'Bad Request'),
  'a __proto__ key': { ...echo({}), body: '{"body":{"__proto__":{"polluted":true}}}' },
  'invalid UTF-8 inside a string': echo({ a: '\ufffd\ufffd' }),
  'a continuation byte first': errorPage(400, 'Bad Request'),
  'multibyte characters one byte per chunk': echo({ word: '\u00e9\u20ac\u{1f600}' }),
  'charset=utf-16le': echo({ word: 'caf\u00e9' }),
  'charset=latin1': errorPage(415, 'Unsupported Media Type'),
  'charset=utf8': errorPage(415, 'Unsupported Media Type'),
  'charset=utf-9': errorPage(415, 'Unsupported Media Type'),
  'a parameter other than charset': echo({ a: 1 }),
  'a +json suffix type': echo([1]),
  'a vendor +json type': echo('<undefined>'),
  'JSON listed with text': echo({ a: 1 }),
  'JSON listed with a form': echo({ a: '1' }),
  'a form': echo({ a: '1', b: { c: '2' } }),
  'text/plain': echo('<undefined>'),
  'no content type': echo('<undefined>'),
  gzip: echo({ a: 1 }),
  deflate: echo({ a: 1 }),
  brotli: echo({ a: 1 }),
  'corrupt gzip': errorPage(400, 'Bad Request'),
  'an unsupported encoding': errorPage(415, 'Unsupported Media Type'),
  'a body at the limit': echo({ a: 'x'.repeat(1016) }),
  'a body over the limit': tooLarge(1025),
  'a chunked body over the limit': tooLarge(),
  'gzip that inflates over the limit': tooLarge(),
};

type ErrorShape = Record<string, unknown>;

const describeError = (error: unknown): ErrorShape => {
  const shape: ErrorShape = { ...(error as Record<string, unknown>) };
  const { name, message, stack } = error as Error;
  return { name, message, stackHead: stack?.split('\n')[0], keys: Object.keys(error as object), ...shape };
};

const parseFailed = (name: string, message: string, body: string): ErrorShape => ({
  name,
  message,
  stackHead: `${name}: ${message}`,
  keys: ['expose', 'statusCode', 'status', 'body', 'type'],
  expose: true,
  statusCode: 400,
  status: 400,
  body,
  type: 'entity.parse.failed',
});

const unsupported = (key: string, value: string, message: string, type: string): ErrorShape => ({
  name: 'UnsupportedMediaTypeError',
  message,
  stackHead: `UnsupportedMediaTypeError: ${message}`,
  keys: ['message', key, 'type'],
  [key]: value,
  type,
});

const ERRORS: Record<string, ErrorShape> = {
  'only whitespace': parseFailed('SyntaxError', 'Unexpected end of JSON input', '  \n'),
  'a string literal': parseFailed('SyntaxError', 'Unexpected token \'"\', ""text"" is not valid JSON', '"text"'),
  'a number literal': parseFailed('SyntaxError', 'Unexpected token \'4\', "42" is not valid JSON', '42'),
  'a true literal': parseFailed('SyntaxError', 'Unexpected token \'t\', "true" is not valid JSON', 'true'),
  'a bare word': parseFailed('SyntaxError', 'Unexpected token \'x\', " x{}" is not valid JSON', ' x{}'),
  'two byte order marks': parseFailed(
    'SyntaxError',
    'Unexpected token \'\ufeff\', "\ufeff{"a":1}" is not valid JSON',
    '\ufeff{"a":1}',
  ),
  'a truncated object': parseFailed('SyntaxError', 'Unexpected end of JSON input', '{"a":'),
  'an unquoted key': parseFailed(
    'SyntaxError',
    "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    '{a:1}',
  ),
  'trailing garbage': parseFailed(
    'SyntaxError',
    'Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)',
    '{"a":1}x',
  ),
  'a continuation byte first': parseFailed(
    'SyntaxError',
    'Unexpected token \'\ufffd\', "\ufffd{}" is not valid JSON',
    '\ufffd{}',
  ),
  'charset=latin1': unsupported('charset', 'latin1', 'unsupported charset "LATIN1"', 'charset.unsupported'),
  'charset=utf8': unsupported('charset', 'utf8', 'unsupported charset "UTF8"', 'charset.unsupported'),
  'charset=utf-9': unsupported('charset', 'utf-9', 'unsupported charset "UTF-9"', 'charset.unsupported'),
  'an unsupported encoding': unsupported(
    'encoding',
    'compress',
    'unsupported content encoding "compress"',
    'encoding.unsupported',
  ),
  'corrupt gzip': {
    name: 'BadRequestError',
    message: 'Bad Request',
    stackHead: 'BadRequestError: Bad Request',
    keys: ['message', 'errno', 'code'],
    errno: -3,
    code: 'Z_DATA_ERROR',
  },
};

describe('ExpressHostAdapter request bodies', () => {
  let server: { url: string; close: () => Promise<void> };
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
    errorLog.mockRestore();
  });

  it.each(Object.keys(REQUESTS))('answers %s as before', async (name) => {
    expect(await send(server.url, REQUESTS[name])).toEqual(ANSWERS[name]);
  });
});

describe('ExpressHostAdapter request body errors', () => {
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer((app) => {
      app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(299).json(describeError(error));
      });
    });
  });

  afterAll(() => server.close());

  it.each(Object.keys(ERRORS))('passes on the same error for %s', async (name) => {
    const answer = await send(server.url, REQUESTS[name]);
    expect(answer.status).toBe(299);
    expect(JSON.parse(answer.body)).toEqual(ERRORS[name]);
  });
});
