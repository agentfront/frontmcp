import { InboxError, parseSignInLink, runInbox, terminalIo, type InboxIo } from '../inbox';

const ORIGIN = 'http://127.0.0.1:3000';
const QUESTION = {
  id: 'q-1',
  key: 'deploy',
  message: 'Deploy v2?',
  requestedSchema: { type: 'object', properties: { approve: { type: 'boolean' } } },
  answered: false,
};

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
}

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init).forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

function server(routes: Record<string, (sent: Sent) => Response>) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const request: Sent = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: headersOf(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
      redirect: init.redirect,
    };
    sent.push(request);
    const route = routes[`${request.method} ${new URL(request.url).pathname}`];
    return route ? route(request) : new Response(JSON.stringify({ error: 'No such route' }), { status: 404 });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

const signedIn = () =>
  new Response('<html></html>', {
    status: 200,
    headers: { 'Set-Cookie': 'frontmcp_people=session-value; Path=/; HttpOnly; SameSite=Strict' },
  });

function io(fetchImpl: typeof fetch, replies?: string[], link = ''): InboxIo & { printed: string[] } {
  const printed: string[] = [];
  return {
    printed,
    fetch: fetchImpl,
    print: (line) => printed.push(line),
    ask: replies ? async () => replies.shift() ?? '' : undefined,
    readLink: async () => link,
  };
}

jest.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: async () => '2', close: jest.fn() }),
}));

describe('terminalIo', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };

  afterEach(() => {
    process.stdin.isTTY = tty.stdin;
    process.stdout.isTTY = tty.stdout;
  });

  it('only lists, without asking, when not on a terminal', () => {
    process.stdin.isTTY = false;

    expect(terminalIo().ask).toBeUndefined();
  });

  it('asks on a terminal, and prints to it', async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const terminal = terminalIo();

    terminal.print('hello');

    expect(await terminal.ask?.('Which? ')).toBe('2');
    expect(log).toHaveBeenCalledWith('hello');
    log.mockRestore();
  });

  it('reads the link from FRONTMCP_INBOX_LINK, else from a terminal, never from the command line', async () => {
    process.stdin.isTTY = true;
    process.env['FRONTMCP_INBOX_LINK'] = ' http://127.0.0.1:3000/_frontmcp/people/login?code=from-env \n';
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(await terminalIo().readLink()).toBe('http://127.0.0.1:3000/_frontmcp/people/login?code=from-env');
      delete process.env['FRONTMCP_INBOX_LINK'];
      expect(await terminalIo().readLink()).toBe('2');
    } finally {
      delete process.env['FRONTMCP_INBOX_LINK'];
      write.mockRestore();
    }
  });

  it('reads the link from the first line piped in', async () => {
    process.stdin.isTTY = false;
    const lines = jest.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {
      yield Buffer.from('\n  /_frontmcp/people/login?code=piped  \nignored\n');
    } as never);

    try {
      expect(await terminalIo().readLink()).toBe('/_frontmcp/people/login?code=piped');
    } finally {
      lines.mockRestore();
    }
  });
});

describe('parseSignInLink', () => {
  it('reads the server and the code of a sign-in link', () => {
    expect(parseSignInLink(`${ORIGIN}/_frontmcp/people/login?code=abc_D-1&next=%2F_frontmcp%2Finbox`)).toEqual({
      origin: ORIGIN,
      code: 'abc_D-1',
    });
  });

  it('takes a path or a bare code with the server URL', () => {
    expect(parseSignInLink('/_frontmcp/people/login?code=abc', `${ORIGIN}/`)).toEqual({ origin: ORIGIN, code: 'abc' });
    expect(parseSignInLink('abc', ORIGIN)).toEqual({ origin: ORIGIN, code: 'abc' });
  });

  it.each([
    ['a path without --url', '/_frontmcp/people/login?code=abc', undefined],
    ['a link without a code', `${ORIGIN}/_frontmcp/people/login`, undefined],
    ['a code that is not one', 'not a code!', ORIGIN],
    ['a server URL that is not one', 'abc', 'not a url'],
    ['plain http to another host', 'http://192.168.1.5:3000/_frontmcp/people/login?code=abc', undefined],
    ['a scheme that is not http', 'file:///_frontmcp/people/login?code=abc', undefined],
  ])('refuses %s', (_case, link, base) => {
    expect(() => parseSignInLink(link, base)).toThrow(InboxError);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://127.1.2.3:3000',
    'http://[::1]:3000',
    'http://app.localhost:3000',
    'https://inbox.example.com',
  ])('takes %s', (origin) => {
    expect(parseSignInLink(`${origin}/_frontmcp/people/login?code=abc`)).toEqual({ origin, code: 'abc' });
  });
});

describe('runInbox', () => {
  it('signs in with the one-time code, then lists the waiting questions with the session', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () =>
        Response.json({ questions: [QUESTION, { ...QUESTION, id: 'q-2', answered: true }] }),
    });
    const console = io(fetchImpl);

    await runInbox(`${ORIGIN}/_frontmcp/people/login?code=abc`, {}, console);

    expect(sent[0]).toEqual(
      expect.objectContaining({ method: 'POST', body: 'code=abc', url: `${ORIGIN}/_frontmcp/people/login` }),
    );
    expect(sent[0].headers['origin']).toBeUndefined();
    expect(sent[1].headers['cookie']).toBe('frontmcp_people=session-value');
    expect(console.printed.join('\n')).toContain('1. Deploy v2?');
    expect(console.printed.join('\n')).not.toContain('q-2');
  });

  it('answers a question by id', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'POST /_frontmcp/questions/q-1/answer': () => Response.json({ answered: true }),
    });

    await runInbox('abc', { url: ORIGIN, answer: 'q-1', content: '{"approve":true}' }, io(fetchImpl));

    expect(JSON.parse(sent[1].body ?? '')).toEqual({ action: 'accept', content: { approve: true } });
    expect(sent[1].headers['content-type']).toBe('application/json');
  });

  it('declines a question by id', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'POST /_frontmcp/questions/q-1/answer': () => Response.json({ answered: true }),
    });

    await runInbox('abc', { url: ORIGIN, answer: 'q-1', decline: true }, io(fetchImpl));

    expect(JSON.parse(sent[1].body ?? '')).toEqual({ action: 'decline' });
  });

  it('answers interactively on a terminal', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () => Response.json({ questions: [QUESTION] }),
      'POST /_frontmcp/questions/q-1/answer': () => Response.json({ answered: true }),
    });
    const console = io(fetchImpl, ['1', '{"approve":false}', '']);

    await runInbox('abc', { url: ORIGIN }, console);

    expect(JSON.parse(sent[2].body ?? '')).toEqual({ action: 'accept', content: { approve: false } });
    expect(console.printed).toContain('Answered.');
  });

  it('asks again after a pick that is not a question, and prints a refused answer', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () => Response.json({ questions: [QUESTION] }),
      'POST /_frontmcp/questions/q-1/answer': () =>
        Response.json({ error: 'This question was answered already.' }, { status: 409 }),
    });
    const console = io(fetchImpl, ['7', '1', 'decline', '']);

    await runInbox('abc', { url: ORIGIN }, console);

    expect(JSON.parse(sent[2].body ?? '')).toEqual({ action: 'decline' });
    expect(console.printed).toEqual(
      expect.arrayContaining([
        'No such question.',
        'The answer was refused (409): This question was answered already.',
      ]),
    );
  });

  it('says so when no question is waiting', async () => {
    const { fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () => Response.json({ questions: [] }),
    });
    const console = io(fetchImpl);

    await runInbox('abc', { url: ORIGIN }, console);

    expect(console.printed).toEqual(['No question is waiting for you.']);
  });

  it('refuses a server that signs nobody in', async () => {
    const { fetchImpl } = server({ 'POST /_frontmcp/people/login': () => new Response('ok') });

    await expect(runInbox('abc', { url: ORIGIN }, io(fetchImpl))).rejects.toThrow('signed nobody in');
  });

  it("reports the server's refusal", async () => {
    const { fetchImpl } = server({
      'POST /_frontmcp/people/login': () => Response.json({ error: 'The sign-in code is not valid' }, { status: 401 }),
    });

    await expect(runInbox('abc', { url: ORIGIN }, io(fetchImpl))).rejects.toThrow(
      'Sign-in refused (401): The sign-in code is not valid',
    );
  });

  it('reads the link when the command line gives none', async () => {
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () => Response.json({ questions: [] }),
    });

    await runInbox(undefined, {}, io(fetchImpl, undefined, `${ORIGIN}/_frontmcp/people/login?code=read-in`));

    expect(sent[0].body).toBe('code=read-in');
  });

  it('follows no redirect, so neither the session nor an answer goes to another server', async () => {
    const elsewhere = { status: 307, headers: { Location: 'https://elsewhere.example/_frontmcp/questions' } };
    const { sent, fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () => new Response(null, elsewhere),
      'POST /_frontmcp/questions/q-1/answer': () => new Response(null, elsewhere),
    });

    await expect(runInbox('abc', { url: ORIGIN }, io(fetchImpl))).rejects.toThrow('The inbox refused (307)');
    await expect(runInbox('abc', { url: ORIGIN, answer: 'q-1', decline: true }, io(fetchImpl))).rejects.toThrow(
      'The answer was refused (307)',
    );
    expect(sent.map((request) => request.redirect)).toEqual(['manual', 'manual', 'manual', 'manual']);
    expect(sent.some((request) => request.url.includes('elsewhere'))).toBe(false);
  });

  it('prints no terminal control sequence the server sends', async () => {
    const { fetchImpl } = server({
      'POST /_frontmcp/people/login': signedIn,
      'GET /_frontmcp/questions': () =>
        Response.json({
          questions: [
            { ...QUESTION, message: 'Deploy v2?\u001b[2K\u001b]52;c;Y3VybA==\u0007\u202e', key: 'k\u009b1m' },
          ],
        }),
      'POST /_frontmcp/questions/q-1/answer': () =>
        Response.json({ error: 'No\u001b[31m such question.' }, { status: 404 }),
    });
    const console = io(fetchImpl, ['1', 'decline', '']);

    await runInbox('abc', { url: ORIGIN }, console);

    const printed = console.printed.join('\n');
    expect(printed).toContain('1. Deploy v2?[2K]52;c;Y3VybA==');
    expect(printed).toContain('The answer was refused (404): No[31m such question.');
    // eslint-disable-next-line no-control-regex -- the control characters the CLI must have stripped
    expect(printed).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
  });

  it('refuses an answer with no content, and content that is not JSON', async () => {
    const { fetchImpl } = server({ 'POST /_frontmcp/people/login': signedIn });

    await expect(runInbox('abc', { url: ORIGIN, answer: 'q-1' }, io(fetchImpl))).rejects.toThrow(InboxError);
    await expect(runInbox('abc', { url: ORIGIN, answer: 'q-1', content: '{' }, io(fetchImpl))).rejects.toThrow(
      'The answer must be JSON',
    );
  });
});
