import { LoopbackTokenAuth } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import {
  httpRespond,
  HttpRoute,
  HttpRouteContext,
  NO_STORE_HEADERS,
  type ExecutionContextBase,
  type HttpOutput,
  type HttpRouteType,
} from '../../common';
import { ElicitationNotSupportedError, InvalidInputError } from '../../errors';
import { questionSubjectOf } from './question-subject';
import { QuestionNotFoundError } from './question.errors';
import { QUESTIONS_TOPIC, type PersistentQuestion, type QuestionStore } from './question.store';

export const QUESTION_INBOX_PATH = '/_frontmcp/inbox';
export const QUESTIONS_PATH = '/_frontmcp/questions';
const PEOPLE_LOGIN_PATH = '/_frontmcp/people/login';

const answerBodySchema = z
  .object({
    action: z.enum(['accept', 'decline', 'cancel'], { message: "action must be 'accept', 'decline' or 'cancel'" }),
    content: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function parsedBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

async function inboxOf(route: HttpRouteContext, store: QuestionStore): Promise<{ questions: PersistentQuestion[] }> {
  const subject = route.person?.subject;
  return { questions: subject ? await store.list(subject) : [] };
}

function printToStderr(message: string): void {
  if (typeof process !== 'undefined' && typeof process.stderr?.write === 'function') process.stderr.write(message);
  else console.warn(message);
}

function stderrIsTerminal(): boolean {
  return typeof process !== 'undefined' && process.stderr?.isTTY === true;
}

/**
 * Print a one-time sign-in link to the question inbox of the caller of `context` (a tool, an agent) on the server's
 * stderr, where the person at the machine reads it, as they read the startup token. The person who opens it, in a
 * browser or with `frontmcp inbox`, sees and answers that caller's questions, and no one else's. The caller gets only
 * the link's expiry. By default (`elicitation.persistent.inboxLinks: 'terminal'`) the link is printed only while stderr
 * is a terminal: stderr that goes to a log, an MCP client or an agent would let its reader answer the questions.
 */
export function printQuestionInboxLink(context: ExecutionContextBase): { expiresAt: number } {
  const people = context.tryGet(LoopbackTokenAuth);
  if (!people) throw new ElicitationNotSupportedError('The question inbox needs people auth: set http.auth.people');
  const questions = context.scope.persistentQuestions;
  if (!questions) throw new ElicitationNotSupportedError('The question inbox needs elicitation.persistent');
  if (questions.inboxLinks === 'off') {
    throw new ElicitationNotSupportedError(
      "Inbox links are off (elicitation.persistent.inboxLinks: 'off'): send createCode({ subject }) codes yourself",
    );
  }
  if (questions.inboxLinks === 'terminal' && !stderrIsTerminal()) {
    throw new ElicitationNotSupportedError(
      "The server's stderr is not a terminal, so an inbox link printed there could reach a log or the client that " +
        "started the server: set elicitation.persistent.inboxLinks: 'stderr' to print it anyway",
    );
  }
  const subject = questionSubjectOf(context.tryGetContext()?.authInfo);
  if (!subject) {
    throw new ElicitationNotSupportedError('The question inbox is for a signed-in user or a session, not this caller');
  }
  const { code, expiresAt } = people.createCode({ subject });
  const link = `${PEOPLE_LOGIN_PATH}?code=${code}&next=${encodeURIComponent(QUESTION_INBOX_PATH)}`;
  printToStderr(
    `[frontmcp] question inbox sign-in link: ${link}\n` +
      `[frontmcp] It works once, until ${new Date(expiresAt).toISOString()}: open it on this server, ` +
      'or run frontmcp inbox --url <server> and paste it.\n',
  );
  return { expiresAt };
}

/** The inbox routes of a scope's persistent questions: subject routes, which show a person their subject's questions. */
export function questionInboxRoutes(store: QuestionStore): HttpRouteType[] {
  @HttpRoute({ method: 'GET', path: QUESTIONS_PATH, auth: 'subject' })
  class QuestionListRoute extends HttpRouteContext {
    async handle(): Promise<HttpOutput> {
      return httpRespond.json(await inboxOf(this, store), { headers: { ...NO_STORE_HEADERS } });
    }
  }

  @HttpRoute({
    method: 'GET',
    path: `${QUESTIONS_PATH}/events`,
    auth: 'subject',
    sse: { store, topics: [QUESTIONS_TOPIC] },
  })
  class QuestionEventsRoute extends HttpRouteContext {
    handle() {
      return inboxOf(this, store);
    }
  }

  @HttpRoute({ method: 'POST', path: `${QUESTIONS_PATH}/:id/answer`, auth: 'subject' })
  class QuestionAnswerRoute extends HttpRouteContext {
    async handle() {
      const parsed = answerBodySchema.safeParse(parsedBody(this.request.body));
      if (!parsed.success) {
        throw new InvalidInputError(
          'The answer must be JSON: { "action": "accept", "content": { ... } }',
          parsed.error.issues,
        );
      }
      const subject = this.person?.subject;
      if (!subject) throw new QuestionNotFoundError();
      const { action, content } = parsed.data;
      await store.answer(subject, this.params['id'] ?? '', { status: action, content });
      return { answered: true };
    }
  }

  @HttpRoute({ method: 'GET', path: QUESTION_INBOX_PATH, auth: 'subject' })
  class QuestionInboxPageRoute extends HttpRouteContext {
    handle(): HttpOutput {
      const nonce = base64urlEncode(randomBytes(16));
      return httpRespond.html(inboxPage(nonce), 200, {
        ...NO_STORE_HEADERS,
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; ` +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
    }
  }

  return [QuestionListRoute, QuestionEventsRoute, QuestionAnswerRoute, QuestionInboxPageRoute];
}

function inboxPage(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Questions</title>
<style>body{font:15px system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}li{margin:0 0 1.5rem}
textarea{width:100%;min-height:4rem;font:13px monospace}pre{background:#f4f4f4;padding:.5rem;overflow:auto}</style>
</head><body><h1>Questions</h1><p id="empty">No question is waiting for you.</p><ol id="questions"></ol>
<script nonce="${nonce}">
const list = document.getElementById('questions');
const empty = document.getElementById('empty');
function button(label, onClick) {
  const element = document.createElement('button');
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
async function answer(id, action, content) {
  const response = await fetch('${QUESTIONS_PATH}/' + encodeURIComponent(id) + '/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content === undefined ? { action } : { action, content }),
  });
  if (!response.ok) alert((await response.json()).error);
}
function render(view) {
  const waiting = view.questions.filter((question) => !question.answered);
  list.replaceChildren(...waiting.map((question) => {
    const item = document.createElement('li');
    const message = document.createElement('p');
    message.textContent = question.message;
    const schema = document.createElement('pre');
    schema.textContent = JSON.stringify(question.requestedSchema, null, 2);
    const content = document.createElement('textarea');
    content.value = '{}';
    const accept = button('Answer', () => {
      try { answer(question.id, 'accept', JSON.parse(content.value)); } catch { alert('The answer must be JSON'); }
    });
    item.append(message, schema, content, accept, button('Decline', () => answer(question.id, 'decline')));
    return item;
  }));
  empty.hidden = waiting.length > 0;
}
new EventSource('${QUESTIONS_PATH}/events').onmessage = (event) => render(JSON.parse(event.data));
</script></body></html>`;
}
