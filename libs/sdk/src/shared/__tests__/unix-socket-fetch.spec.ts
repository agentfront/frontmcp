import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { unixSocketFetch } from '../unix-socket-fetch';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('unixSocketFetch', () => {
  let directory: string;
  let socketPath: string;
  let server: http.Server | undefined;
  const seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }> = [];

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-unix-fetch-'));
    socketPath = path.join(directory, 'server.sock');
    seen.length = 0;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url === '/empty') {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('set-cookie', ['a=1', 'b=2']);
        res.write('data: one\n\n');
        setTimeout(() => res.end('data: two\n\n'), 20);
      });
    });
    await new Promise<void>((resolve) => server?.listen(socketPath, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('sends the method, path, query, headers and body to the socket, and streams the answer back', async () => {
    const response = await unixSocketFetch(socketPath)('http://localhost/mcp?x=1', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('set-cookie')).toBe('a=1, b=2');
    expect(await response.text()).toBe('data: one\n\ndata: two\n\n');
    expect(seen).toEqual([expect.objectContaining({ method: 'POST', url: '/mcp?x=1', body: '{"a":1}' })]);
    expect(seen[0].headers['authorization']).toBe('Bearer t');
  });

  it('answers an empty response with no body', async () => {
    const response = await unixSocketFetch(socketPath)(new Request('http://localhost/empty'));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/empty' });
  });

  it('rejects when nothing listens on the socket', async () => {
    await expect(unixSocketFetch(path.join(directory, 'none.sock'))('http://localhost/')).rejects.toThrow('ENOENT');
  });

  it('rejects when the request is aborted', async () => {
    const controller = new AbortController();
    const pending = unixSocketFetch(socketPath)('http://localhost/', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
