/**
 * #1364: `http.userContent` serves static files on a listener of its own, with its own Host check and headers,
 * and never answers the MCP or API routes.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import type { UserContentOptions } from '../../../common/types/options/http/interfaces';
import { UserContentConfigurationError } from '../../../errors/transport.errors';
import { UserContentListener } from '../user-content.listener';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw HTTP, so the request keeps a forged Host and an unnormalized path. */
function request(
  target: { port: number } | { socketPath: string },
  opts: { method?: string; path?: string; host?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...('port' in target ? { host: '127.0.0.1', port: target.port } : { socketPath: target.socketPath }),
        path: opts.path ?? '/',
        method: opts.method ?? 'GET',
        agent: false,
        headers: {
          ...('port' in target ? { host: opts.host ?? `localhost:${target.port}` } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const posixIt = process.platform === 'win32' ? it.skip : it;

describe('UserContentListener', () => {
  let directory: string;
  let root: string;
  let listener: UserContentListener | undefined;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fmcp-uc-'));
    root = path.join(directory, 'content');
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'site'));
    fs.writeFileSync(path.join(root, 'frame.html'), '<p>frame</p>');
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(root, 'blob.unknownext'), 'bytes');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(root, 'nested', 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'site', 'index.html'), '<p>site</p>');
    fs.writeFileSync(path.join(directory, 'outside.txt'), 'outside the root');
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await listener?.stop(0);
    listener = undefined;
    log.mockRestore();
    warn.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function start(
    options: Partial<UserContentOptions> = {},
    mainListener: number | string = 65_000,
    bindAddress?: string,
  ): Promise<{ port: number }> {
    listener = new UserContentListener({ port: 0, root, ...options });
    await listener.start(mainListener, bindAddress);
    const address = listener.address();
    return { port: typeof address === 'object' && address ? address.port : 0 };
  }

  describe('static files', () => {
    it('serves a file under root with its content type and nosniff', async () => {
      const target = await start();

      const res = await request(target, { path: '/frame.html' });

      expect(res.status).toBe(200);
      expect(res.body).toBe('<p>frame</p>');
      expect(res.headers['content-type']).toBe('text/html; charset=UTF-8');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect((await request(target, { path: '/app.js' })).headers['content-type']).toMatch(/javascript/);
    });

    it('sets a content type on a file whose extension it does not know', async () => {
      const target = await start();

      const res = await request(target, { path: '/blob.unknownext' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
    });

    it('answers HEAD for a file', async () => {
      const target = await start();

      const res = await request(target, { method: 'HEAD', path: '/frame.html' });

      expect(res.status).toBe(200);
      expect(res.body).toBe('');
    });

    it.each([
      ['an encoded ../', '/..%2foutside.txt'],
      ['a raw ../', '/../outside.txt'],
      ['a nested encoded ../', '/nested/..%2f..%2foutside.txt'],
      ['an encoded backslash', '/..%5coutside.txt'],
      ['a null byte', '/frame.html%00.js'],
    ])('never serves a file outside root through %s', async (_label, requestPath) => {
      const target = await start();

      const res = await request(target, { path: requestPath });

      expect(res.status).toBe(404);
      expect(res.body).not.toContain('outside the root');
    });

    it('never serves a dotfile', async () => {
      const target = await start();

      const res = await request(target, { path: '/.env' });

      expect(res.status).toBe(404);
      expect(res.body).not.toContain('SECRET');
    });

    it('never lists a directory', async () => {
      const target = await start();

      for (const requestPath of ['/', '/nested/']) {
        const res = await request(target, { path: requestPath });
        expect(res.status).toBe(404);
        expect(res.body).not.toContain('a.txt');
        expect(res.body).not.toContain('frame.html');
      }
    });

    posixIt.each([
      [
        'a file symlink',
        () => fs.symlinkSync(path.join(directory, 'outside.txt'), path.join(root, 'download')),
        '/download',
      ],
      ['a directory symlink', () => fs.symlinkSync(directory, path.join(root, 'up')), '/up/outside.txt'],
      [
        "a directory's index.html symlink",
        () => {
          fs.mkdirSync(path.join(root, 'docs'));
          fs.symlinkSync(path.join(directory, 'outside.txt'), path.join(root, 'docs', 'index.html'));
        },
        '/docs/',
      ],
    ])('never serves a file outside root through %s', async (_label, link, requestPath) => {
      link();
      const target = await start();

      const res = await request(target, { path: requestPath });

      expect(res.status).toBe(404);
      expect(res.body).not.toContain('outside the root');
    });

    posixIt('serves a symlink that stays inside root', async () => {
      fs.symlinkSync(path.join(root, 'frame.html'), path.join(root, 'latest.html'));
      fs.symlinkSync(path.join(root, 'site'), path.join(root, 'home'));
      const target = await start();

      expect((await request(target, { path: '/latest.html' })).body).toBe('<p>frame</p>');
      expect((await request(target, { path: '/home/' })).body).toBe('<p>site</p>');
    });

    it("serves a directory's index.html", async () => {
      const target = await start();

      const res = await request(target, { path: '/site/' });

      expect(res.status).toBe(200);
      expect(res.body).toBe('<p>site</p>');
    });
  });

  describe('never the MCP or API routes', () => {
    it('answers an MCP request with 404', async () => {
      const target = await start();

      const res = await request(target, {
        method: 'POST',
        path: '/mcp',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

      expect(res.status).toBe(404);
      expect(res.headers['mcp-session-id']).toBeUndefined();
      expect(res.body).toBe('Not Found');
    });

    it.each(['/health', '/healthz', '/metrics', '/.well-known/oauth-protected-resource', '/oauth/authorize', '/'])(
      'answers GET %s with 404',
      async (requestPath) => {
        const target = await start();

        expect((await request(target, { path: requestPath })).status).toBe(404);
      },
    );

    it('does not accept a write to a file', async () => {
      const target = await start();

      const res = await request(target, { method: 'PUT', path: '/frame.html', body: 'replaced' });

      expect(res.status).toBe(404);
      expect(fs.readFileSync(path.join(root, 'frame.html'), 'utf8')).toBe('<p>frame</p>');
    });
  });

  describe('headers', () => {
    it('sends the configured headers and content security policy on every response', async () => {
      const target = await start({
        headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store' },
        csp: { directives: { 'default-src': "'none'", 'img-src': ["'self'", 'data:'], sandbox: '' } },
      });

      for (const requestPath of ['/frame.html', '/missing']) {
        const res = await request(target, { path: requestPath });
        expect(res.headers['content-security-policy']).toBe("default-src 'none'; img-src 'self' data:; sandbox");
        expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('sends a report-only policy with its report URI', async () => {
      const target = await start({
        csp: { directives: { 'script-src': "'self'" }, reportUri: '/csp-report', reportOnly: true },
      });

      const res = await request(target, { path: '/frame.html' });

      expect(res.headers['content-security-policy']).toBeUndefined();
      expect(res.headers['content-security-policy-report-only']).toBe("script-src 'self'; report-uri /csp-report");
    });

    it('lets a configured header replace the nosniff default', async () => {
      const target = await start({ headers: { 'x-content-type-options': 'off' } });

      expect((await request(target, { path: '/frame.html' })).headers['x-content-type-options']).toBe('off');
    });

    it('refuses at startup a header it could not send', async () => {
      await expect(start({ headers: { 'X-Bad': 'one\r\nInjected: two' } })).rejects.toBeInstanceOf(
        UserContentConfigurationError,
      );
      await expect(start({ headers: { 'Bad Name': 'x' } })).rejects.toThrow('header "Bad Name" cannot be sent');
    });
  });

  describe('Host check', () => {
    it('on a loopback bind, accepts its own loopback names and refuses another Host', async () => {
      const target = await start();

      for (const host of [`localhost:${target.port}`, `127.0.0.1:${target.port}`, `[::1]:${target.port}`]) {
        expect((await request(target, { path: '/frame.html', host })).status).toBe(200);
      }
      const rebound = await request(target, { path: '/frame.html', host: 'evil.example' });
      expect(rebound.status).toBe(403);
      expect(rebound.body).not.toContain('frame');
    });

    it('accepts only the configured hosts when allowedHosts is set', async () => {
      const target = await start({ allowedHosts: ['content.example.com'] });

      expect((await request(target, { path: '/frame.html', host: 'content.example.com' })).status).toBe(200);
      expect((await request(target, { path: '/frame.html', host: `localhost:${target.port}` })).status).toBe(403);
    });

    it('refuses a forged X-Forwarded-Host', async () => {
      const target = await start({ allowedHosts: ['content.example.com'] });

      const res = await request(target, {
        path: '/frame.html',
        host: 'content.example.com',
        headers: { 'x-forwarded-host': 'evil.example' },
      });

      expect(res.status).toBe(403);
    });

    it('on a routable bind without allowedHosts, warns and names the option', async () => {
      const target = await start({}, 65_000, '0.0.0.0');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('http.userContent.allowedHosts'));
      expect((await request(target, { path: '/frame.html', host: 'content.example.com' })).status).toBe(200);
    });

    it('does not warn on a routable bind when allowedHosts is set', async () => {
      await start({ allowedHosts: ['content.example.com'] }, 65_000, '0.0.0.0');

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('startup', () => {
    it('refuses the MCP listener port', async () => {
      await expect(start({ port: 3456 }, 3456)).rejects.toThrow(
        "http.userContent: it needs a port or socketPath of its own, not the MCP listener's (3456)",
      );
    });

    it('refuses the MCP listener socket path', async () => {
      const socketPath = path.join(directory, 'main.sock');

      await expect(start({ socketPath }, socketPath)).rejects.toBeInstanceOf(UserContentConfigurationError);
    });

    it('refuses a root that is not a directory', async () => {
      await expect(start({ root: path.join(root, 'frame.html') })).rejects.toThrow('is not a directory');
      await expect(start({ root: path.join(directory, 'missing') })).rejects.toThrow('is not a directory');
    });

    it('resolves a relative root against the working directory', async () => {
      const cwd = process.cwd();
      process.chdir(directory);
      try {
        const target = await start({ root: 'content' });

        expect((await request(target, { path: '/frame.html' })).status).toBe(200);
      } finally {
        process.chdir(cwd);
      }
    });

    it('fails to start when its port is taken', async () => {
      const taken = await start();

      const second = new UserContentListener({ port: taken.port, root });
      await expect(second.start(65_000)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      await second.stop(0);
    });
  });

  describe('on a Unix socket', () => {
    posixIt('serves files owner-only, with no Host check', async () => {
      const socketPath = path.join(directory, 'content.sock');
      listener = new UserContentListener({ socketPath, root });
      await listener.start(65_000);

      expect(fs.lstatSync(socketPath).mode & 0o777).toBe(0o600);
      const res = await request({ socketPath }, { path: '/frame.html', headers: { host: 'anything' } });
      expect(res.status).toBe(200);
      expect(res.body).toBe('<p>frame</p>');
    });

    posixIt('checks no Host even when allowedHosts is set, which applies to a port only', async () => {
      const socketPath = path.join(directory, 'content.sock');
      listener = new UserContentListener({ socketPath, root, allowedHosts: ['content.example.com'] });
      await listener.start(65_000);

      const res = await request({ socketPath }, { path: '/frame.html', headers: { host: 'localhost' } });

      expect(res.status).toBe(200);
      expect(res.body).toBe('<p>frame</p>');
    });
  });

  describe('stop', () => {
    it('closes the listener', async () => {
      const target = await start();
      await listener?.stop();

      await expect(request(target, { path: '/frame.html' })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    it('is safe before start and twice', async () => {
      const idle = new UserContentListener({ port: 0, root });
      await idle.stop();
      await start();
      await listener?.stop(0);
      await listener?.stop(0);
    });
  });
});
