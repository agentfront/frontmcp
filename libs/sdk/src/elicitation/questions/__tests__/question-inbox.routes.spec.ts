/**
 * The question inbox: people routes through the `http:route` flow, where a person signed in for a subject sees and
 * answers that subject's questions only.
 */
import 'reflect-metadata';

import { LoopbackTokenAuth } from '@frontmcp/auth';

import { createTestFetchServer } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, HttpRoute, HttpRouteContext, LogLevel, type FrontMcpConfigInput } from '../../../common';
import { ElicitationNotSupportedError } from '../../../errors';
import { type FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type Scope } from '../../../scope/scope.instance';
import { printQuestionInboxLink } from '../question-inbox.routes';
import { type QuestionStore } from '../question.store';

@HttpRoute({ method: 'GET', path: '/board' })
class BoardRoute extends HttpRouteContext {
  handle() {
    return { board: true };
  }
}

@App({ id: 'inbox', name: 'inbox', routes: [BoardRoute] })
class InboxApp {}

const ORIGIN = 'http://localhost';
const SCHEMA = { type: 'object', properties: { approve: { type: 'boolean' } }, required: ['approve'] };

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'inbox', version: '1.0.0' },
  apps: [InboxApp],
  logging: { level: LogLevel.Off },
  http: { auth: { people: 'loopback-token' } },
  elicitation: { enabled: true, persistent: { storage: { type: 'memory' } } },
};

type Send = (path: string, init?: RequestInit) => Promise<Response>;

describe('the question inbox', () => {
  let instance: FrontMcpInstance;
  let send: Send;
  let people: LoopbackTokenAuth;
  let store: QuestionStore;
  let stderr: jest.SpyInstance;

  beforeAll(async () => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const server = await createTestFetchServer(CONFIG);
    instance = server.instance;
    send = (path, init) => server.handler(new Request(`${ORIGIN}${path}`, init));
    const scope = instance.getScopes()[0] as Scope;
    people = scope.providers.get(LoopbackTokenAuth);
    const questions = scope.persistentQuestions;
    if (!questions) throw new Error('persistent questions are off');
    store = questions.store;
  });

  afterAll(async () => {
    await instance.shutdown();
    stderr.mockRestore();
  });

  async function signInFor(subject?: string): Promise<string> {
    const { code } = people.createCode(subject ? { subject } : {});
    const login = await send('/_frontmcp/people/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: `code=${code}`,
    });
    return (login.headers.get('set-cookie') ?? '').split(';')[0];
  }

  async function ask(subject: string, key: string): Promise<string> {
    const outcome = await store.ask({
      subject,
      key,
      message: `${subject} asks ${key}`,
      requestedSchema: SCHEMA,
      ttlMs: 60_000,
      waiter: `waiter-${key}`,
    });
    if (outcome.kind !== 'waiting') throw new Error('the question was not asked');
    return outcome.question.id;
  }

  const answer = (cookie: string, id: string, body: unknown, origin = ORIGIN) =>
    send(`/_frontmcp/questions/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
      body: JSON.stringify(body),
    });

  it('refuses a browser that has not signed in', async () => {
    expect((await send('/_frontmcp/questions')).status).toBe(401);
    expect((await send('/_frontmcp/questions/events', { headers: { Accept: 'text/event-stream' } })).status).toBe(401);
    expect((await send('/_frontmcp/inbox')).status).toBe(401);
  });

  it("opens no other people page with a subject's sign-in, and no inbox with the startup token's", async () => {
    const alice = await signInFor('principal:alice');
    const operator = await signInFor();

    expect((await send('/board', { headers: { Cookie: alice } })).status).toBe(401);
    expect((await send('/board', { headers: { Cookie: operator } })).status).toBe(200);
    expect((await send('/_frontmcp/questions', { headers: { Cookie: operator } })).status).toBe(401);
    expect((await send('/_frontmcp/inbox', { headers: { Cookie: operator } })).status).toBe(401);
  });

  it("shows a person the questions of the subject their code was made for, and no one else's", async () => {
    await ask('principal:alice', 'deploy');
    await ask('principal:bob', 'rollback');
    const alice = await signInFor('principal:alice');

    const response = await send('/_frontmcp/questions', { headers: { Cookie: alice } });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      questions: [expect.objectContaining({ key: 'deploy', message: 'principal:alice asks deploy', answered: false })],
    });
  });

  it('answers a question of the subject, once', async () => {
    const id = await ask('principal:alice', 'answer-once');
    const alice = await signInFor('principal:alice');

    const first = await answer(alice, id, { action: 'accept', content: { approve: true } });
    const second = await answer(alice, id, { action: 'accept', content: { approve: false } });

    expect([first.status, second.status]).toEqual([200, 409]);
    expect(await store.take('principal:alice', 'answer-once', 'waiter-answer-once')).toEqual({
      kind: 'answered',
      answer: { status: 'accept', content: { approve: true } },
    });
  });

  it('gives another subject "not found", and refuses a person signed in with the token', async () => {
    const id = await ask('principal:alice', 'not-yours');
    const bob = await signInFor('principal:bob');
    const operator = await signInFor();

    const asBob = await answer(bob, id, { action: 'decline' });
    const asOperator = await answer(operator, id, { action: 'decline' });

    expect([asBob.status, asOperator.status]).toEqual([404, 401]);
    expect((await store.list('principal:alice')).find((question) => question.id === id)?.answered).toBe(false);
  });

  it('refuses an answer that does not match the schema, or is not an answer', async () => {
    const id = await ask('principal:alice', 'schema');
    const alice = await signInFor('principal:alice');

    expect((await answer(alice, id, { action: 'accept', content: { approve: 'yes' } })).status).toBe(400);
    expect((await answer(alice, id, { action: 'maybe' })).status).toBe(400);
  });

  it('reads an answer sent as text, and refuses text that is not JSON', async () => {
    const id = await ask('principal:alice', 'as-text');
    const alice = await signInFor('principal:alice');
    const post = (body: string) =>
      send(`/_frontmcp/questions/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Cookie: alice, Origin: ORIGIN },
        body,
      });

    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ action: 'decline' }))).status).toBe(200);
  });

  it('refuses an answer posted from another site', async () => {
    const id = await ask('principal:alice', 'cross-site');
    const alice = await signInFor('principal:alice');

    const response = await answer(alice, id, { action: 'decline' }, 'https://evil.example');

    expect(response.status).toBe(403);
    expect((await store.list('principal:alice')).find((question) => question.id === id)?.answered).toBe(false);
  });

  it('streams the inbox, and a new question of the subject', async () => {
    const carol = await signInFor('principal:carol');
    const controller = new AbortController();
    const response = await send('/_frontmcp/questions/events', {
      headers: { Cookie: carol, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    try {
      expect(await nextView(reader)).toEqual({ questions: [] });
      await ask('principal:carol', 'streamed');
      expect(await nextView(reader)).toEqual({ questions: [expect.objectContaining({ key: 'streamed' })] });
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it('serves the inbox page with a script nonce, never caching it', async () => {
    const alice = await signInFor('principal:alice');

    const response = await send('/_frontmcp/inbox', { headers: { Cookie: alice } });
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(nonce).toBeDefined();
    expect(await response.text()).toContain(`<script nonce="${nonce}">`);
  });
});

describe('printQuestionInboxLink', () => {
  const people = new LoopbackTokenAuth({
    mode: 'loopback-token',
    codeTtlMs: 60_000,
    sessionTtlMs: 60_000,
    maxFailedAttempts: 5,
    lockoutMs: 60_000,
    cookiePath: '/',
  });
  const stderrIsTerminal = process.stderr.isTTY;
  const context = (
    authInfo: unknown,
    options: { withPeople?: boolean; inboxLinks?: string; questions?: boolean } = {},
  ) =>
    ({
      tryGet: () => (options.withPeople === false ? undefined : people),
      tryGetContext: () => ({ authInfo }),
      scope: {
        persistentQuestions: options.questions === false ? undefined : { inboxLinks: options.inboxLinks ?? 'terminal' },
      },
    }) as never;
  let printed: string[];
  let write: jest.SpyInstance;

  beforeEach(() => {
    printed = [];
    write = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    write.mockRestore();
    process.stderr.isTTY = stderrIsTerminal;
  });

  it('prints a sign-in link for the subject of the call on the terminal, and gives the caller no code', () => {
    process.stderr.isTTY = true;

    const result = printQuestionInboxLink(context({ user: { sub: 'alice' } }));
    const link = /question inbox sign-in link: (\S+)/.exec(printed.join(''))?.[1] ?? '';
    const code = new URL(link, 'http://localhost').searchParams.get('code') ?? '';
    const session = people.exchangeCode(code, 'client');

    expect(result).toEqual({ expiresAt: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain(code);
    expect(link).toBe(`/_frontmcp/people/login?code=${code}&next=%2F_frontmcp%2Finbox`);
    expect(session.ok && people.verifySession(session.cookieValue)?.subject).toBe('principal:alice');
  });

  it('prints nothing while stderr is not a terminal, unless inboxLinks is stderr', () => {
    process.stderr.isTTY = false;

    expect(() => printQuestionInboxLink(context({ user: { sub: 'alice' } }))).toThrow(/stderr is not a terminal/);
    expect(printed).toEqual([]);
    printQuestionInboxLink(context({ user: { sub: 'alice' } }, { inboxLinks: 'stderr' }));
    expect(printed.join('')).toContain('question inbox sign-in link: /_frontmcp/people/login?code=');
  });

  it("prints nothing with inboxLinks 'off'", () => {
    process.stderr.isTTY = true;

    expect(() => printQuestionInboxLink(context({ user: { sub: 'alice' } }, { inboxLinks: 'off' }))).toThrow(
      /inboxLinks: 'off'/,
    );
    expect(printed).toEqual([]);
  });

  it('is refused without people auth, without persistent questions, and for an anonymous caller', () => {
    process.stderr.isTTY = true;

    expect(() => printQuestionInboxLink(context({ user: { sub: 'alice' } }, { withPeople: false }))).toThrow(
      ElicitationNotSupportedError,
    );
    expect(() => printQuestionInboxLink(context({ user: { sub: 'alice' } }, { questions: false }))).toThrow(
      ElicitationNotSupportedError,
    );
    expect(() => printQuestionInboxLink(context({ user: { sub: 'anon:1' } }))).toThrow(ElicitationNotSupportedError);
    expect(printed).toEqual([]);
  });
});

async function nextView(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 10_000): Promise<unknown> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    const boundary = text.indexOf('\n\n');
    if (boundary !== -1) {
      const block = text.slice(0, boundary);
      text = text.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) return JSON.parse(data);
      continue;
    }
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  throw new Error('no view arrived in time');
}
