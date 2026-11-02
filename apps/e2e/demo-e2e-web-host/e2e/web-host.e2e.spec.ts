/**
 * The web host: `@HttpRoute` pages served beside the MCP endpoint through the `http:route` flow, behind people auth
 * (`http.auth.people: 'loopback-token'`): the token printed at startup buys a one-time code, the code posted from the
 * server's own page buys an HttpOnly cookie. Pages share the app's providers with its tools, a cross-site mutation is
 * refused, and an SSE page hears a resource change a tool made.
 */
import { expect, test, type ServerFixture } from '@frontmcp/testing';

const TOKEN_LINE = /people sign-in token: ([A-Za-z0-9_-]{43})/;

function startupToken(server: ServerFixture): string {
  const line = server.getLogs().find((entry) => TOKEN_LINE.test(entry));
  if (!line) throw new Error('the server printed no sign-in token');
  return (TOKEN_LINE.exec(line) as RegExpExecArray)[1];
}

async function signInCode(server: ServerFixture, token: string): Promise<string> {
  const response = await fetch(`${server.info.baseUrl}/_frontmcp/people/code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { code: string }).code;
}

function postCode(server: ServerFixture, code: string, origin = server.info.baseUrl): Promise<Response> {
  return fetch(`${server.info.baseUrl}/_frontmcp/people/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
    body: new URLSearchParams({ code }).toString(),
    redirect: 'manual',
  });
}

async function signIn(server: ServerFixture): Promise<string> {
  const response = await postCode(server, await signInCode(server, startupToken(server)));
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0];
}

/** Read SSE events from `response` until `accept` takes one, with a generous deadline for a loaded machine. */
async function nextEvent<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  accept: (event: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffered = '';
  while (Date.now() < deadline) {
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), deadline - Date.now()));
    const chunk = await Promise.race([reader.read(), timeout]);
    if (chunk === 'timeout' || chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    let boundary = buffered.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) {
        const event = JSON.parse(data) as T;
        if (accept(event)) return event;
      }
      boundary = buffered.indexOf('\n\n');
    }
  }
  throw new Error(`no matching event within ${timeoutMs} ms`);
}

test.describe('Web host E2E', () => {
  test.use({ server: 'apps/e2e/demo-e2e-web-host/src/main.ts', project: 'demo-e2e-web-host', publicMode: true });

  test('prints the sign-in token once, and never again', async ({ server }) => {
    const token = startupToken(server);

    expect(server.getLogs().join('\n').split(token).length - 1).toBe(1);
  });

  test('a person signs in with a one-time code posted from the server page', async ({ server }) => {
    const { baseUrl } = server.info;
    const code = await signInCode(server, startupToken(server));

    const page = await fetch(`${baseUrl}/_frontmcp/people/login?code=${code}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(await page.text()).toContain('method="post"');

    const login = await postCode(server, code);
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^frontmcp_people=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
    expect(setCookie).not.toContain(startupToken(server));

    const reused = await postCode(server, code);
    expect(reused.status).toBe(401);

    const board = await fetch(`${baseUrl}/board`, { headers: { Cookie: setCookie.split(';')[0] } });
    expect(board.status).toBe(200);
  });

  test('a page refuses a browser that has not signed in, and a public page serves it', async ({ server }) => {
    const { baseUrl } = server.info;

    expect((await fetch(`${baseUrl}/board`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/board`, { headers: { Cookie: 'frontmcp_people=forged' } })).status).toBe(401);
    expect(await (await fetch(`${baseUrl}/status`)).json()).toEqual({ ok: true });
  });

  test('refuses a code posted from another site', async ({ server }) => {
    const code = await signInCode(server, startupToken(server));

    const response = await postCode(server, code, 'https://evil.example');

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('refuses a cross-site mutation, and serves the same one from the server page', async ({ server }) => {
    const { baseUrl } = server.info;
    const cookie = await signIn(server);
    const add = (origin: string) =>
      fetch(`${baseUrl}/board/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
        body: JSON.stringify({ title: 'from the page' }),
      });

    const crossSite = await add('https://evil.example');
    expect(crossSite.status).toBe(403);

    const sameOrigin = await add(baseUrl);
    expect(sameOrigin.status).toBe(200);
  });

  test('an SSE page hears the resource change a tool makes', async ({ server, mcp }) => {
    const cookie = await signIn(server);
    const controller = new AbortController();
    const response = await fetch(`${server.info.baseUrl}/board/events`, {
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    try {
      const first = await nextEvent<{ cards: string[]; revision: number }>(reader, () => true);
      const added = await mcp.tools.call('add-card', { title: 'from an agent' });
      expect(added).toBeSuccessful();

      const update = await nextEvent<{ cards: string[]; revision: number }>(
        reader,
        (event) => event.revision > first.revision,
      );
      expect(update.cards).toContain('from an agent');
    } finally {
      controller.abort();
    }
  });

  test('a page and a tool share the app providers', async ({ server, mcp }) => {
    const cookie = await signIn(server);
    const visitsFromTool = async () => ((await mcp.tools.call('record-visit', {})).json() as { visits: number }).visits;
    const visitsFromPage = async () =>
      (
        (await (await fetch(`${server.info.baseUrl}/board`, { headers: { Cookie: cookie } })).json()) as {
          visits: number;
        }
      ).visits;

    const first = await visitsFromTool();
    const second = await visitsFromPage();
    const third = await visitsFromTool();

    expect([second, third]).toEqual([first + 1, first + 2]);
  });
});
