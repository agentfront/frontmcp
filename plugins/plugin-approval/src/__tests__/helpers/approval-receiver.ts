/** A local HTTP server standing in for an approval system: it records each request and answers as a test says. */
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  json: Record<string, unknown>;
}

export type Answer = (request: ReceivedRequest, response: ServerResponse) => void;

export interface ApprovalReceiver {
  url: string;
  requests: ReceivedRequest[];
  /** Answers the next requests with this, and every later one with the last given. */
  answerWith(...answers: Answer[]): void;
  close(): Promise<void>;
}

export const json =
  (status: number, body: unknown): Answer =>
  (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

export async function startApprovalReceiver(path = '/hook'): Promise<ApprovalReceiver> {
  const requests: ReceivedRequest[] = [];
  let answers: Answer[] = [json(200, { ok: true })];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const received = { path: request.url ?? '', headers: request.headers, body, json: parsed };
      requests.push(received);
      const answer = answers.length > 1 ? (answers.shift() as Answer) : answers[0];
      answer(received, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${path}`,
    requests,
    answerWith: (...next) => {
      answers = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
