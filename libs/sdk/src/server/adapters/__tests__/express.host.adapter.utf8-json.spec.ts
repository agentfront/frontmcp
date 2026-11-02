import * as http from 'node:http';
import * as path from 'node:path';

import type express from 'express';

import { ExpressHostAdapter } from '../express.host.adapter';

// Mock base.host.adapter to break the import chain into ../../common (which pulls @frontmcp/auth)
jest.mock('../base.host.adapter', () => {
  class HostServerAdapter {}
  return { HostServerAdapter };
});

const resolveFrom = (name: string, from: string): string => require.resolve(name, { paths: [path.dirname(from)] });

// The iconv-lite that body-parser's raw-body decodes with.
const iconvLite = (): { encodings: object | null } => {
  const bodyParser = resolveFrom('body-parser', require.resolve('express'));
  return require(resolveFrom('iconv-lite', resolveFrom('raw-body', bodyParser)));
};

const post = (url: string, contentType: string, body: Buffer): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { agent: false, method: 'POST', headers: { 'content-type': contentType, 'content-length': body.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });

describe('ExpressHostAdapter JSON bodies and iconv-lite', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const adapter = new ExpressHostAdapter();
    adapter.registerRoute('POST', '/echo', (req: unknown, res: unknown) => {
      (res as express.Response).json((req as { body: unknown }).body);
    });
    server = http.createServer(adapter.getHandler() as http.RequestListener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/echo`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('parses a UTF-8 JSON body without loading the encodings of iconv-lite', async () => {
    expect(await post(url, 'application/json', Buffer.from('{"a":"caf\u00e9"}'))).toEqual({
      status: 200,
      body: '{"a":"caf\u00e9"}',
    });
    expect(iconvLite().encodings).toBeNull();
  });

  it('decodes a UTF-16 JSON body with iconv-lite', async () => {
    const body = Buffer.from('{"a":1}', 'utf16le');
    expect(await post(url, 'application/json; charset=utf-16le', body)).toEqual({ status: 200, body: '{"a":1}' });
    expect(iconvLite().encodings).not.toBeNull();
  });
});
