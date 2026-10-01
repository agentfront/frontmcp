import { FlowControl, type ServerRequest, type ServerResponse } from '../../../common';
import { PublicMcpError } from '../../../errors';
import { serveRelayedHttpRequest } from '../relay-flow';
import { RelayServerResponse, type RelayChunk } from '../relay-http';

function createResponse() {
  const heads: Array<{ status: number; headers: Record<string, string | string[]> }> = [];
  let body = '';
  let ended = false;
  const response = new RelayServerResponse({
    head: (status, headers) => heads.push({ status, headers }),
    data: (chunk: RelayChunk) => {
      body += chunk.encoding === 'utf8' ? chunk.data : Buffer.from(chunk.data, 'base64').toString();
    },
    end: () => {
      ended = true;
    },
  });
  return {
    response,
    asServer: response.asServerResponse(),
    heads,
    body: () => body,
    ended: () => ended,
  };
}

const request = { headers: {}, method: 'POST', path: '/' } as unknown as ServerRequest;

describe('serveRelayedHttpRequest', () => {
  it('runs the request through the http:request flow with the relayed request and response', async () => {
    const out = createResponse();
    const runFlow = jest.fn().mockResolvedValue({
      kind: 'json',
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: { ok: true },
    });

    await serveRelayedHttpRequest({ runFlow }, request, out.asServer);

    expect(runFlow).toHaveBeenCalledWith('http:request', { request, response: out.asServer });
    expect(out.heads[0].status).toBe(200);
    expect(out.body()).toBe('{"ok":true}');
    expect(out.ended()).toBe(true);
  });

  it('renders a respond() FlowControl', async () => {
    const out = createResponse();
    const runFlow = jest.fn().mockRejectedValue(
      new FlowControl('respond', {
        kind: 'text',
        status: 403,
        body: 'denied',
        contentType: 'text/plain; charset=utf-8',
      }),
    );

    await serveRelayedHttpRequest({ runFlow }, request, out.asServer);

    expect(out.heads[0].status).toBe(403);
    expect(out.body()).toBe('denied');
  });

  it('writes nothing more when a stage already answered and called handled()', async () => {
    const out = createResponse();
    const runFlow = jest.fn(async (_name: string, input: { response: ServerResponse }) => {
      input.response.status(202).json({ accepted: true });
      throw new FlowControl('handled', null);
    });

    await serveRelayedHttpRequest({ runFlow: runFlow as never }, request, out.asServer);

    expect(out.heads).toHaveLength(1);
    expect(out.heads[0].status).toBe(202);
  });

  it('answers 404 when no stage claimed the request', async () => {
    const out = createResponse();
    await serveRelayedHttpRequest(
      { runFlow: jest.fn().mockRejectedValue(new FlowControl('next', null)) },
      request,
      out.asServer,
    );
    expect(out.heads[0].status).toBe(404);
    expect(out.body()).toBe('{"error":"Not Found"}');
  });

  it('ends a response a stage started but left open', async () => {
    const out = createResponse();
    const runFlow = jest.fn(async (_name: string, input: { response: ServerResponse }) => {
      input.response.writeHead(200, { 'content-type': 'text/event-stream' });
      throw new FlowControl('handled', null);
    });

    await serveRelayedHttpRequest({ runFlow: runFlow as never }, request, out.asServer);

    expect(out.heads[0].status).toBe(200);
    expect(out.ended()).toBe(true);
  });

  it('maps a public error to its status, and anything else to 500', async () => {
    const publicOut = createResponse();
    await serveRelayedHttpRequest(
      { runFlow: jest.fn().mockRejectedValue(new PublicMcpError('nope', 'NOPE', 409)) },
      request,
      publicOut.asServer,
    );
    expect(publicOut.heads[0].status).toBe(409);
    expect(publicOut.body()).toContain('nope');

    const internalOut = createResponse();
    await serveRelayedHttpRequest(
      { runFlow: jest.fn().mockRejectedValue(new Error('boom')) },
      request,
      internalOut.asServer,
    );
    expect(internalOut.heads[0].status).toBe(500);
    expect(internalOut.body()).toBe('Internal Server Error');
  });

  it('does not render an output over a response that is already complete', async () => {
    const out = createResponse();
    const runFlow = jest.fn(async (_name: string, input: { response: ServerResponse }) => {
      input.response.status(200).end('done');
      return { kind: 'text', status: 500, body: 'late', contentType: 'text/plain' };
    });

    await serveRelayedHttpRequest({ runFlow: runFlow as never }, request, out.asServer);

    expect(out.heads).toHaveLength(1);
    expect(out.body()).toBe('done');
  });
});
