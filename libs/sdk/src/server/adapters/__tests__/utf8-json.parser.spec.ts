import * as http from 'node:http';

import express from 'express';

import { utf8JsonParser } from '../utf8-json.parser';

type Outcome = Record<string, unknown>;

const describeError = (error: unknown): Outcome => {
  const { name, message, stack } = error as Error;
  return { name, message, stackHead: stack?.split('\n')[0], keys: Object.keys(error as object), ...(error as object) };
};

const listen = async (parsers: express.RequestHandler[]): Promise<{ url: string; server: http.Server }> => {
  const app = express();
  app.use(...parsers);
  app.post('/', (req, res) => {
    res.json({ parsed: req.body === undefined ? '<undefined>' : req.body });
  });
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.json({ error: describeError(error), body: req.body === undefined ? '<undefined>' : req.body });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server };
};

const post = (url: string, contentType: string, body: Buffer, chunked: boolean): Promise<Outcome> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { 'content-type': contentType };
    if (!chunked) headers['content-length'] = body.length;
    const req = http.request(url, { agent: false, method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (chunked) {
      for (let offset = 0; offset < body.length; offset += 3) req.write(body.subarray(offset, offset + 3));
    } else {
      req.write(body);
    }
    req.end();
  });

const random = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};

const FRAGMENTS = [
  '{',
  '}',
  '[',
  ']',
  '"',
  ':',
  ',',
  ' ',
  '\n',
  '\t',
  '\r',
  'a',
  '1',
  '-',
  '.',
  'e',
  'true',
  'null',
  '\\',
  'u00',
  'é',
  '€',
  '\u{1f600}',
  '﻿',
  '#',
].map((fragment) => Buffer.from(fragment));
const BYTES = [0xff, 0xc3, 0x80, 0xe2, 0xef, 0xbb, 0xbf].map((byte) => Buffer.from([byte]));

const generatedBodies = (count: number): Buffer[] => {
  const next = random(951);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
  const bodies: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      const value = { text: pick(['', 'café', '\u{1f600}', 'x'.repeat(Math.floor(next() * 40))]), list: [i, null] };
      const prefix = pick(['', ' ', '﻿', '﻿ \n']);
      bodies.push(Buffer.from(prefix + JSON.stringify(i % 2 ? value : [value])));
    } else {
      const length = Math.floor(next() * 12);
      bodies.push(Buffer.concat(Array.from({ length }, () => (next() < 0.8 ? pick(FRAGMENTS) : pick(BYTES)))));
    }
  }
  return bodies;
};

describe('utf8JsonParser', () => {
  let stock: { url: string; server: http.Server };
  let utf8: { url: string; server: http.Server };

  beforeAll(async () => {
    stock = await listen([express.json({ limit: '1kb' })]);
    utf8 = await listen([utf8JsonParser('1kb'), express.json({ limit: '1kb' })]);
  });

  afterAll(async () => {
    for (const { server } of [stock, utf8]) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ['application/json', false],
    ['application/json; charset=utf-8', true],
  ])('parses %s bodies (chunked: %s) as express.json() does', async (contentType, chunked) => {
    for (const body of generatedBodies(150)) {
      const expected = await post(stock.url, contentType, body, chunked);
      expect({ body: body.toString('hex'), outcome: await post(utf8.url, contentType, body, chunked) }).toEqual({
        body: body.toString('hex'),
        outcome: expected,
      });
    }
  });

  it('leaves alone a body an earlier middleware read, as express.json() does', async () => {
    const readEarlier: express.RequestHandler = (req, _res, next) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        req.body = Buffer.concat(chunks);
        next();
      });
    };
    const earlier = await listen([readEarlier, utf8JsonParser('1kb'), express.json({ limit: '1kb' })]);
    const stockEarlier = await listen([readEarlier, express.json({ limit: '1kb' })]);
    try {
      const body = Buffer.from('{"a":1}');
      const expected = await post(stockEarlier.url, 'application/json', body, false);
      expect(expected).toEqual({ status: 200, parsed: { type: 'Buffer', data: [...body] } });
      expect(await post(earlier.url, 'application/json', body, false)).toEqual(expected);
    } finally {
      for (const { server } of [earlier, stockEarlier])
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('leaves a body in another charset to express.json()', async () => {
    const body = Buffer.from('{"a":"café"}', 'utf16le');
    expect(await post(utf8.url, 'application/json; charset=utf-16le', body, false)).toEqual({
      status: 200,
      parsed: { a: 'café' },
    });
  });

  it('passes on a read error such as a body over the limit', async () => {
    const outcome = await post(utf8.url, 'application/json', Buffer.from(`["${'x'.repeat(1100)}"]`), false);
    expect(outcome).toMatchObject({ error: { type: 'entity.too.large', limit: 1024, length: 1104 } });
  });
});
