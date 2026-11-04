/**
 * `@HttpRoute` classes run through the `http:route` flow on the Express host and on the web-fetch handler alike:
 * IP filter, same-origin check on mutations, people auth, then the route's `handle()` with the app's providers.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type * as net from 'node:net';

import { LoopbackTokenAuth } from '@frontmcp/auth';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  frontMcpMetadataSchema,
  httpRespond,
  HttpRoute,
  LogLevel,
  Plugin,
  Provider,
  ProviderScope,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import { PublicMcpError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { resourceStore } from '../../resource/materialized';
import { type Scope } from '../../scope/scope.instance';
import { createServerFetchHandler } from '../../transport/web-fetch-handler';

@Provider({ name: 'Counter', scope: ProviderScope.GLOBAL })
class Counter {
  private count = 0;

  next(): number {
    return ++this.count;
  }
}

@Tool({ name: 'count', inputSchema: {} })
class CountTool extends ToolContext {
  async execute() {
    return { count: this.get(Counter).next() };
  }
}

@Tool({ name: 'sign-in-code', inputSchema: {} })
class SignInCodeTool extends ToolContext {
  async execute() {
    return { code: this.get(LoopbackTokenAuth).createCode().code };
  }
}

const notesStore = resourceStore({ coalesceMs: 0 });
const notes = notesStore.key<string[]>('notes', { initial: [] });
const unsubscribed = jest.fn();
const topics = {
  subscribe(topic: string, listener: () => void) {
    const stop = notesStore.subscribe(topic, listener);
    return () => {
      unsubscribed(topic);
      stop();
    };
  },
};

@HttpRoute({ method: 'GET', path: '/count' })
class CountPage extends HttpRouteContext {
  handle() {
    return { count: this.get(Counter).next(), signedIn: this.person !== undefined };
  }
}

@HttpRoute({ method: 'GET', path: '/hello/:name', auth: 'public' })
class HelloRoute extends HttpRouteContext {
  handle() {
    return `hello ${this.params['name']}`;
  }
}

@HttpRoute({ method: 'GET', path: '/page', auth: 'public' })
class PageRoute extends HttpRouteContext {
  handle() {
    return httpRespond.html('<h1>page</h1>');
  }
}

@HttpRoute({ method: 'POST', path: '/notes', auth: 'public' })
class AddNoteRoute extends HttpRouteContext {
  async handle() {
    await notes.update((current) => [...current, String((this.request.body as { note?: string })?.note)]);
  }
}

@HttpRoute({ method: 'GET', path: '/notes', auth: 'public' })
class ListNotesRoute extends HttpRouteContext {
  async handle() {
    return (await notes.get()).value;
  }
}

@HttpRoute({
  method: 'GET',
  path: '/notes/events',
  auth: 'public',
  sse: { store: topics, topics: ['notes'], coalesceMs: 5 },
})
class NoteEvents extends HttpRouteContext {
  async handle() {
    return (await notes.get()).value;
  }
}

@HttpRoute({ method: 'GET', path: '/notes/mine', sse: { store: topics, topics: ['notes'], coalesceMs: 5 } })
class MyNoteEvents extends HttpRouteContext {
  async handle() {
    return (await notes.get()).value;
  }
}

@HttpRoute({ method: 'GET', path: '/', auth: 'public' })
class HomeRoute extends HttpRouteContext {
  handle() {
    return 'home';
  }
}

@HttpRoute({ method: 'GET', path: '/fails', auth: 'public' })
class FailingRoute extends HttpRouteContext {
  handle(): string {
    throw new Error('the route failed');
  }
}

@HttpRoute({ method: 'GET', path: '/to/board', auth: 'public' })
class RelativeRedirectRoute extends HttpRouteContext {
  handle() {
    return httpRespond.redirect('/board');
  }
}

@HttpRoute({ method: 'GET', path: '/to/desk', auth: 'public' })
class AbsoluteRedirectRoute extends HttpRouteContext {
  handle() {
    return httpRespond.redirect('https://desk.example.com/board');
  }
}

@HttpRoute({ method: 'GET', path: '/moved', auth: 'public' })
class MovedRoute extends HttpRouteContext {
  handle() {
    return { ...httpRespond.redirect('/board'), status: 301 as const };
  }
}

@HttpRoute({ method: 'GET', path: '/to/split', auth: 'public' })
class SplitHeaderRedirectRoute extends HttpRouteContext {
  handle() {
    return httpRespond.redirect('/board\r\nSet-Cookie: session=forged');
  }
}

@HttpRoute({ method: 'GET', path: '/json-redirect', auth: 'public' })
class InvalidJsonRoute extends HttpRouteContext {
  handle() {
    return { ...httpRespond.json({ board: 'kanban' }), status: 301 };
  }
}

@HttpRoute({ method: 'GET', path: '/card', auth: 'public' })
class CardRoute extends HttpRouteContext {
  handle() {
    return { kind: 'card', title: 'Ship 1.11.1' };
  }
}

@HttpRoute({ method: 'GET', path: '/message-part', auth: 'public' })
class MessagePartRoute extends HttpRouteContext {
  handle() {
    return { kind: 'text', text: 'hello' };
  }
}

@HttpRoute({ method: 'GET', path: '/to/back', auth: 'public' })
class BackRedirectRoute extends HttpRouteContext {
  handle() {
    return httpRespond.redirect('back');
  }
}

@App({
  id: 'web',
  name: 'web',
  providers: [Counter],
  tools: [CountTool, SignInCodeTool],
  routes: [
    CountPage,
    HelloRoute,
    PageRoute,
    AddNoteRoute,
    ListNotesRoute,
    NoteEvents,
    MyNoteEvents,
    HomeRoute,
    FailingRoute,
    RelativeRedirectRoute,
    AbsoluteRedirectRoute,
    MovedRoute,
    SplitHeaderRedirectRoute,
    InvalidJsonRoute,
    CardRoute,
    MessagePartRoute,
    BackRedirectRoute,
  ],
})
class WebApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'web-host', version: '1.0.0' },
  apps: [WebApp],
  logging: { level: LogLevel.Off },
  // Permissive CORS turns the loopback Origin check off, so the route's own same-origin check is what refuses.
  http: { auth: { people: 'loopback-token' }, cors: { origin: true } },
};

interface Harness {
  name: string;
  origin: string;
  instance: FrontMcpInstance;
  send(path: string, init?: RequestInit): Promise<Response>;
}

const printed: string[] = [];
const TOKEN_LINE = /people sign-in token: ([A-Za-z0-9_-]{43})/;

function tokenPrintedAfter(index: number): string {
  const line = printed.slice(index).find((entry) => TOKEN_LINE.test(entry));
  if (!line) throw new Error('no sign-in token was printed');
  return (TOKEN_LINE.exec(line) as RegExpExecArray)[1];
}

async function startExpress(config: FrontMcpConfigInput): Promise<Harness> {
  const opened: http.Server[] = [];
  const realCreateServer = http.createServer.bind(http);
  const spy = jest.spyOn(http, 'createServer').mockImplementation(((...args: never[]) => {
    const created = (realCreateServer as (...a: never[]) => http.Server)(...args);
    opened.push(created);
    return created;
  }) as never);
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const instance = new FrontMcpInstance(
      frontMcpMetadataSchema.parse({ ...config, http: { ...config.http, port: 0 } }),
    );
    await instance.ready;
    await instance.start();
    const { port } = opened[0].address() as net.AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    return { name: 'express', origin, instance, send: (path, init) => fetch(`${origin}${path}`, init) };
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
}

async function startWebFetch(config: FrontMcpConfigInput): Promise<Harness> {
  const { handler, instance } = await createTestFetchServer(config);
  const origin = 'http://localhost';
  return { name: 'web-fetch', origin, instance, send: (path, init) => handler(new Request(`${origin}${path}`, init)) };
}

async function signIn(harness: Harness, token: string): Promise<string> {
  const issued = await harness.send('/_frontmcp/people/code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const { code } = (await issued.json()) as { code: string };
  const login = await harness.send('/_frontmcp/people/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: harness.origin },
    body: `code=${code}`,
  });
  return (login.headers.get('set-cookie') ?? '').split(';')[0];
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

beforeAll(() => {
  const write = process.stderr.write.bind(process.stderr);
  jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array, ...rest: never[]) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    printed.push(text);
    return TOKEN_LINE.test(text) ? true : write(chunk, ...rest);
  }) as never);
});

afterAll(() => jest.restoreAllMocks());

describe.each([
  ['express', startExpress],
  ['web-fetch', startWebFetch],
])('@HttpRoute on the %s adapter', (_adapter, start) => {
  let harness: Harness;
  let token: string;

  beforeAll(async () => {
    const before = printed.length;
    harness = await start(CONFIG);
    token = tokenPrintedAfter(before);
  });

  // A fetch client keeps a spare connection after an aborted stream; the host closes it at the end of its drain.
  afterAll(async () => {
    await harness.instance.shutdown();
  }, 15_000);

  describe('people auth', () => {
    it('refuses a page to a browser that has not signed in', async () => {
      const response = await harness.send('/count');

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: expect.stringContaining('sign in') });
    });

    it('serves the page to a signed-in browser, with the person on the context', async () => {
      const cookie = await signIn(harness, token);

      const response = await harness.send('/count', { headers: { Cookie: cookie } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ count: expect.any(Number), signedIn: true });
    });

    it('sets an HttpOnly, SameSite=Strict, Path-scoped cookie whose value is not the token', async () => {
      const issued = await harness.send('/_frontmcp/people/code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { code } = (await issued.json()) as { code: string };

      const login = await harness.send('/_frontmcp/people/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: harness.origin },
        body: JSON.stringify({ code, next: '/count' }),
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/^frontmcp_people=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Strict$/);
      expect(cookie).not.toContain(token);
      expect(await login.text()).toContain('url=/count');
    });

    it('refuses a code posted from another site', async () => {
      const issued = await harness.send('/_frontmcp/people/code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { code } = (await issued.json()) as { code: string };

      const login = await harness.send('/_frontmcp/people/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
        body: `code=${code}`,
      });

      expect(login.status).toBe(403);
      expect(login.headers.get('set-cookie')).toBeNull();
    });

    it('signs in one of two requests that spend the same code at once', async () => {
      const issued = await harness.send('/_frontmcp/people/code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { code } = (await issued.json()) as { code: string };
      const spend = () =>
        harness.send('/_frontmcp/people/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: harness.origin },
          body: `code=${code}`,
        });

      const statuses = (await Promise.all([spend(), spend()])).map((response) => response.status).sort();

      expect(statuses).toEqual([200, 401]);
    });

    it('refuses a wrong token', async () => {
      const response = await harness.send('/_frontmcp/people/code', {
        method: 'POST',
        headers: { Authorization: 'Bearer not-the-token' },
      });

      expect(response.status).toBe(401);
    });

    it('serves a sign-in page that posts the code, without signing in on GET', async () => {
      const response = await harness.send('/_frontmcp/people/login?code=abc_DEF-123&next=/count');

      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      const page = await response.text();
      expect(page).toContain('<form method="post" action="/_frontmcp/people/login">');
      expect(page).toContain('value="abc_DEF-123"');
      expect(page).toContain('value="/count"');
    });

    it('does not echo a sign-in link that is not a code', async () => {
      const response = await harness.send('/_frontmcp/people/login?code=%22%3E%3Cscript%3E&next=//evil.example');

      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('<script>');
    });
  });

  describe('responses', () => {
    it('answers text with the path parameters', async () => {
      const response = await harness.send('/hello/ada');

      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toBe('hello ada');
    });

    it('answers an output from httpRespond as it is', async () => {
      const response = await harness.send('/page');

      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe('<h1>page</h1>');
    });

    it('answers 204 when handle() returns nothing', async () => {
      const response = await harness.send('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'from a CLI' }),
      });

      expect(response.status).toBe(204);
    });

    it('answers 500 for a route that throws, without its message', async () => {
      const response = await harness.send('/fails');

      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('the route failed');
    });

    it('redirects to a path, as httpRespond.redirect() names it (#1053)', async () => {
      const response = await harness.send('/to/board', { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/board');
    });

    it('redirects to an absolute URL', async () => {
      const response = await harness.send('/to/desk', { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://desk.example.com/board');
    });

    it("answers a redirect with the output's status", async () => {
      const response = await harness.send('/moved', { redirect: 'manual' });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/board');
    });

    it.each([
      ['a redirect whose location would split the header', '/to/split'],
      ['a JSON output with a redirect status', '/json-redirect'],
    ])('answers 500 and logs the error for %s, never the output as data', async (_case, path) => {
      const logged = jest.spyOn(harness.instance.getPrimaryScope()?.logger as Scope['logger'], 'error');
      try {
        const response = await harness.send(path, { redirect: 'manual' });

        expect(response.status).toBe(500);
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.text()).not.toContain('kind');
        expect(logged).toHaveBeenCalledWith(expect.stringContaining(`GET ${path}`));
      } finally {
        logged.mockRestore();
      }
    });

    it.each([
      ['whose kind is not an httpRespond kind', '/card', { kind: 'card', title: 'Ship 1.11.1' }],
      ['with an httpRespond kind and no status', '/message-part', { kind: 'text', text: 'hello' }],
    ])('sends an object %s as JSON', async (_case, path, body) => {
      const response = await harness.send(path);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(body);
    });

    it('sends the location as given, never reading it from the Referer', async () => {
      const response = await harness.send('/to/back', {
        redirect: 'manual',
        headers: { Referer: 'https://evil.example/phish' },
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('back');
    });
  });

  describe('the same-origin check', () => {
    it.each([
      ['another site', { Origin: 'https://evil.example' }],
      ['a cross-site fetch without an Origin', { 'Sec-Fetch-Site': 'cross-site' }],
      [
        'another site that names itself in X-Forwarded-Host',
        { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' },
      ],
    ])('refuses a mutation from %s', async (_case, headers) => {
      const response = await harness.send('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ note: 'forged' }),
      });

      expect(response.status).toBe(403);
      expect(((await (await harness.send('/notes')).json()) as string[]).includes('forged')).toBe(false);
    });

    it('answers the refusal with its own error', async () => {
      const response = await harness.send('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ note: 'forged' }),
      });

      expect(await response.json()).toEqual({ error: 'Cross-origin requests may not change anything here.' });
    });

    it('serves a mutation from the server page', async () => {
      const response = await harness.send('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: harness.origin },
        body: JSON.stringify({ note: 'from the page' }),
      });

      expect(response.status).toBe(204);
    });

    it('lets a page GET from another site through', async () => {
      const response = await harness.send('/hello/ada', { headers: { Origin: 'https://evil.example' } });

      expect(response.status).toBe(200);
    });
  });

  describe('a route on the MCP path', () => {
    it('serves a page load', async () => {
      expect(await (await harness.send('/')).text()).toBe('home');
    });

    it('leaves the MCP event stream to the MCP endpoint', async () => {
      const response = await harness.send('/', { headers: { Accept: 'text/event-stream' } });

      expect(await response.text()).not.toBe('home');
    });
  });

  describe('an SSE route', () => {
    it('sends the view, then the view after a change, and stops listening when the client leaves', async () => {
      unsubscribed.mockClear();
      const controller = new AbortController();
      const response = await harness.send('/notes/events', { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();

      expect(await readEvent(reader)).toMatch(/^data: \[.*\]\n\n$/);
      await notes.update((current) => [...current, 'live']);
      expect(await readEvent(reader)).toContain('"live"');

      controller.abort();
      await reader.cancel().catch(() => undefined);
      await waitFor(() => unsubscribed.mock.calls.length === 1);
      expect(unsubscribed).toHaveBeenCalledWith('notes');
    });

    it('ends a signed-in stream once the session ends', async () => {
      const cookie = await signIn(harness, token);
      const response = await harness.send('/notes/mine', { headers: { Cookie: cookie } });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await readEvent(reader);

      const people = (harness.instance.getScopes()[0] as Scope).providers.get(LoopbackTokenAuth);
      people.endSession(cookie.slice(cookie.indexOf('=') + 1));
      await notes.update((current) => [...current, 'after sign-out']);

      expect(await readEvent(reader)).toBe('');
    });
  });
});

describe('@HttpRoute providers', () => {
  it('shares the app providers with its tools', async () => {
    const before = printed.length;
    const harness = await startWebFetch(CONFIG);
    const cookie = await signIn(harness, tokenPrintedAfter(before));
    const handler = (request: Request) => harness.send(new URL(request.url).pathname, request);

    const fromTool = await rpc20260728(handler, 'tools/call', { name: 'count', arguments: {} });
    const fromPage = (await (await harness.send('/count', { headers: { Cookie: cookie } })).json()) as {
      count: number;
    };

    expect(fromTool.message.result?.['structuredContent']).toEqual({ count: 1 });
    expect(fromPage.count).toBe(2);
    await harness.instance.shutdown();
  });

  it('lets a tool hand a person a one-time sign-in code', async () => {
    const harness = await startWebFetch(CONFIG);
    const handler = (request: Request) => harness.send(new URL(request.url).pathname, request);

    const issued = await rpc20260728(handler, 'tools/call', { name: 'sign-in-code', arguments: {} });
    const { code } = issued.message.result?.['structuredContent'] as { code: string };
    const login = await harness.send('/_frontmcp/people/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: harness.origin },
      body: `code=${code}`,
    });

    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('frontmcp_people=');
    await harness.instance.shutdown();
  });
});

const RouteHook = FlowHooksOf('http:route');

@Plugin({ name: 'route-gate' })
class RouteGatePlugin {
  @RouteHook.Will('handle')
  refuseBlocked(ctx: { rawInput: { request: { path: string } } }) {
    if (ctx.rawInput.request.path === '/hello/blocked') throw new PublicMcpError('blocked by a hook', 'BLOCKED', 451);
  }
}

describe('the http:route flow', () => {
  it('runs the hooks a plugin puts on its stages', async () => {
    const harness = await startWebFetch({ ...CONFIG, plugins: [RouteGatePlugin] });

    expect((await harness.send('/hello/blocked')).status).toBe(451);
    expect(await (await harness.send('/hello/ada')).text()).toBe('hello ada');
    await harness.instance.shutdown();
  });
});

describe('the session cookie over https', () => {
  it('is Secure', async () => {
    const { handler, instance } = await createTestFetchServer(CONFIG);
    const { code } = (instance.getScopes()[0] as Scope).providers.get(LoopbackTokenAuth).createCode();

    const login = await handler(
      new Request('https://localhost/_frontmcp/people/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
        body: JSON.stringify({ code }),
      }),
    );

    expect(login.headers.get('set-cookie')).toMatch(/; HttpOnly; Secure; SameSite=Strict$/);
    await instance.shutdown();
  });
});

describe('bad sign-in codes', () => {
  it('lock the client out, with 429, even from a good code', async () => {
    const harness = await startWebFetch(CONFIG);
    const post = (code: string) =>
      harness.send('/_frontmcp/people/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: harness.origin },
        body: JSON.stringify({ code }),
      });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) statuses.push((await post(`wrong-${attempt}`)).status);
    const { code } = (harness.instance.getScopes()[0] as Scope).providers.get(LoopbackTokenAuth).createCode();

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await post(code)).status).toBe(429);
    await harness.instance.shutdown();
  });
});

describe('bad sign-in tokens with a new X-Forwarded-For each time, and no trusted proxy', () => {
  it('lock the peer out all the same', async () => {
    const harness = await startExpress(CONFIG);
    const post = (attempt: number) =>
      harness.send('/_frontmcp/people/code', {
        method: 'POST',
        headers: { Authorization: `Bearer wrong-${attempt}`, 'X-Forwarded-For': `198.51.100.${attempt}` },
      });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) statuses.push((await post(attempt)).status);

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    await harness.instance.shutdown();
  });
});

describe('an SSE route on shutdown', () => {
  it('ends the stream and stops listening', async () => {
    const harness = await startExpress(CONFIG);
    unsubscribed.mockClear();
    const response = await harness.send('/notes/events');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await readEvent(reader);

    const started = Date.now();
    await harness.instance.shutdown();

    expect(await reader.read()).toEqual({ value: undefined, done: true });
    expect(unsubscribed).toHaveBeenCalledWith('notes');
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('an SSE route whose client leaves before the stream opens', () => {
  let reachedHandle = false;
  let release: () => void = () => undefined;
  const clientLeft = new Promise<void>((resolve) => (release = resolve));

  @Plugin({ name: 'hold-stream' })
  class HoldStreamPlugin {
    @RouteHook.Will('handle')
    async holdUntilTheClientLeaves(ctx: { rawInput: { request: { path: string } } }) {
      if (ctx.rawInput.request.path !== '/notes/events') return;
      reachedHandle = true;
      await clientLeft;
    }
  }

  it('stops listening on the Express host', async () => {
    const harness = await startExpress({ ...CONFIG, plugins: [HoldStreamPlugin] });
    unsubscribed.mockClear();
    const request = http.get(`${harness.origin}/notes/events`);
    request.on('error', () => undefined);
    await waitFor(() => reachedHandle);

    request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    await waitFor(() => unsubscribed.mock.calls.length === 1);
    await harness.instance.shutdown();
  });
});

describe('the sign-in token', () => {
  it('is printed once for a server of several scopes', async () => {
    @App({ id: 'side', name: 'side', standalone: true, routes: [HelloRoute] })
    class SideApp {}
    const before = printed.length;

    const harness = await startWebFetch({ ...CONFIG, apps: [WebApp, SideApp] });

    expect(printed.slice(before).filter((entry) => TOKEN_LINE.test(entry))).toHaveLength(1);
    await harness.instance.shutdown();
  });
});

describe('a path that routes of two scopes serve', () => {
  @HttpRoute({ method: 'GET', path: '/which', auth: 'public' })
  class FirstWhich extends HttpRouteContext {
    handle() {
      return 'first';
    }
  }

  @HttpRoute({ method: 'GET', path: '/which', auth: 'public' })
  class SecondWhich extends HttpRouteContext {
    handle() {
      return 'second';
    }
  }

  @App({ id: 'a', name: 'a', routes: [FirstWhich] })
  class FirstApp {}

  @App({ id: 'longer', name: 'longer', routes: [SecondWhich] })
  class SecondApp {}

  const config: FrontMcpConfigInput = { ...CONFIG, splitByApp: true, apps: [FirstApp, SecondApp] };

  it('is served by the first scope on the Express host', async () => {
    const harness = await startExpress(config);

    expect(await (await harness.send('/which')).text()).toBe('first');
    await harness.instance.shutdown();
  });

  it('is served by the first scope on the fetch handler', async () => {
    const instance = await FrontMcpInstance.createForGraph({ ...config, logging: { level: LogLevel.Off } });
    const scopes = instance.getScopes() as Scope[];
    const handler = createServerFetchHandler(scopes[0], scopes);

    expect(await (await handler(new Request('http://localhost/which'))).text()).toBe('first');
    await instance.shutdown();
  });
});

describe('throttle.ipFilter', () => {
  it('refuses a denied peer before any route stage', async () => {
    const { instance } = await createTestFetchServer({
      ...CONFIG,
      throttle: { enabled: true, ipFilter: { denyList: ['203.0.113.0/24'] } },
    });
    const scope = instance.getScopes()[0] as Scope;
    const request = {
      method: 'GET',
      path: '/hello/ada',
      url: '/hello/ada',
      headers: {},
      query: {},
      socket: { remoteAddress: '::ffff:203.0.113.9' },
    };

    expect(await scope.runFlow('http:route', { request, response: {} } as never)).toMatchObject({ status: 403 });
    await instance.shutdown();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
