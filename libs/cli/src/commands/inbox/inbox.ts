const LOGIN_PATH = '/_frontmcp/people/login';
const QUESTIONS_PATH = '/_frontmcp/questions';
const SESSION_COOKIE = 'frontmcp_people';
const CODE = /^[A-Za-z0-9_-]{1,128}$/;

/** A mistake in the command, or a refusal from the server: printed without a stack. */
export class InboxError extends Error {}

export interface InboxOptions {
  /** The server's base URL, when the link is a path or a bare code. */
  url?: string;
  /** Answer this question instead of listing them. */
  answer?: string;
  /** The answer, as JSON. */
  content?: string;
  decline?: boolean;
  cancel?: boolean;
}

export interface InboxIo {
  fetch: typeof fetch;
  print(line: string): void;
  /** Asks on a terminal; undefined when there is none, and then the questions are only listed. */
  ask?(prompt: string): Promise<string>;
}

interface InboxQuestion {
  id: string;
  key: string;
  message: string;
  requestedSchema: Record<string, unknown>;
  answered: boolean;
}

type AnswerBody = { action: 'accept'; content: unknown } | { action: 'decline' | 'cancel' };

/** The server and the one-time code of a sign-in link: an absolute link, or its path or code with `--url`. */
export function parseSignInLink(link: string, base?: string): { origin: string; code: string } {
  if (base !== undefined && CODE.test(link)) return { origin: originOf(base), code: link };
  let url: URL;
  try {
    url = new URL(link, base);
  } catch {
    throw new InboxError('Pass the sign-in link the server gave, or its path or code with --url <server>');
  }
  const code = url.searchParams.get('code');
  if (!code || !CODE.test(code)) throw new InboxError('The sign-in link has no code; ask for a new link');
  return { origin: url.origin, code };
}

function originOf(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    throw new InboxError(`--url must be the server's URL, such as http://127.0.0.1:3000 (got "${base}")`);
  }
}

function parseContent(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InboxError('The answer must be JSON, such as {"approve":true}');
  }
}

function answerOf(options: InboxOptions): AnswerBody {
  if (options.decline) return { action: 'decline' };
  if (options.cancel) return { action: 'cancel' };
  if (options.content === undefined) throw new InboxError('--answer needs --content <json>, --decline or --cancel');
  return { action: 'accept', content: parseContent(options.content) };
}

async function refusal(response: Response, what: string): Promise<InboxError> {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  const reason = typeof body?.error === 'string' ? body.error : response.statusText;
  return new InboxError(`${what} (${response.status}): ${reason}`);
}

function sessionCookie(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];
  return cookies.map((cookie) => cookie.split(';')[0]).find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
}

class InboxSession {
  constructor(
    private readonly io: InboxIo,
    private readonly origin: string,
    private readonly cookie: string,
  ) {}

  static async signIn(io: InboxIo, origin: string, code: string): Promise<InboxSession> {
    const response = await io.fetch(`${origin}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `code=${code}`,
      redirect: 'manual',
    });
    if (!response.ok) throw await refusal(response, 'Sign-in refused');
    const cookie = sessionCookie(response);
    if (!cookie) throw new InboxError('The server signed nobody in: is http.auth.people on?');
    return new InboxSession(io, origin, cookie);
  }

  async questions(): Promise<InboxQuestion[]> {
    const response = await this.io.fetch(`${this.origin}${QUESTIONS_PATH}`, { headers: { Cookie: this.cookie } });
    if (!response.ok) throw await refusal(response, 'The inbox refused');
    return ((await response.json()) as { questions: InboxQuestion[] }).questions;
  }

  async answer(id: string, body: AnswerBody): Promise<void> {
    const response = await this.io.fetch(`${this.origin}${QUESTIONS_PATH}/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await refusal(response, 'The answer was refused');
  }
}

function describe(question: InboxQuestion, index: number): string {
  return (
    `${index + 1}. ${question.message}\n` +
    `   id: ${question.id}  key: ${question.key}\n` +
    `   answer with: ${JSON.stringify(question.requestedSchema)}`
  );
}

async function answerInteractively(
  session: InboxSession,
  waiting: InboxQuestion[],
  io: InboxIo & { ask(prompt: string): Promise<string> },
) {
  for (;;) {
    const pick = (await io.ask('Answer which question (number, blank to stop)? ')).trim();
    if (!pick) return;
    const question = waiting[Number(pick) - 1];
    if (!question) {
      io.print('No such question.');
      continue;
    }
    const reply = (await io.ask('Answer as JSON, or decline / cancel: ')).trim();
    try {
      const body: AnswerBody =
        reply === 'decline' || reply === 'cancel'
          ? { action: reply }
          : { action: 'accept', content: parseContent(reply) };
      await session.answer(question.id, body);
      io.print('Answered.');
    } catch (error) {
      if (!(error instanceof InboxError)) throw error;
      io.print(error.message);
    }
  }
}

/**
 * `frontmcp inbox <link>`: spends the one-time code of an inbox sign-in link (printed on the server's console by
 * `printQuestionInboxLink()`) for a session, as a browser would, then lists the questions waiting for that link's
 * caller, or answers one.
 */
export async function runInbox(link: string, options: InboxOptions, io: InboxIo = terminalIo()): Promise<void> {
  const { origin, code } = parseSignInLink(link, options.url);
  const answering = options.answer === undefined ? undefined : { id: options.answer, body: answerOf(options) };
  const session = await InboxSession.signIn(io, origin, code);
  if (answering) {
    await session.answer(answering.id, answering.body);
    io.print(`Answered ${answering.id}.`);
    return;
  }
  const waiting = (await session.questions()).filter((question) => !question.answered);
  if (waiting.length === 0) {
    io.print('No question is waiting for you.');
    return;
  }
  waiting.forEach((question, index) => io.print(describe(question, index)));
  const { ask } = io;
  if (ask) await answerInteractively(session, waiting, { ...io, ask });
}

/** The process's terminal: questions are asked only when both stdin and stdout are one. */
export function terminalIo(): InboxIo {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return {
    fetch: (input, init) => fetch(input, init),
    print: (line) => console.log(line),
    ask: interactive
      ? async (prompt) => {
          const { createInterface } = await import('node:readline/promises');
          const readline = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await readline.question(prompt);
          } finally {
            readline.close();
          }
        }
      : undefined,
  };
}
