/** The protections on every request to an approval system, against a local server. */
import { json, startApprovalReceiver, type ApprovalReceiver } from '../../__tests__/helpers/approval-receiver';
import { OUTBOUND_MAX_RESPONSE_BYTES, OutboundRequestError, postJson } from '../outbound-request';

let receiver: ApprovalReceiver;

beforeEach(async () => {
  receiver = await startApprovalReceiver();
});

afterEach(async () => {
  await receiver.close();
});

const post = (overrides: Partial<Parameters<typeof postJson>[0]> = {}) =>
  postJson({ url: receiver.url, body: '{"a":1}', headers: { 'x-test': 'yes' }, ...overrides });

describe('postJson', () => {
  it('POSTs the JSON body with its headers and returns the answer', async () => {
    receiver.answerWith(json(201, { received: true }));

    await expect(post()).resolves.toEqual({ status: 201, body: '{"received":true}' });
    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0]).toMatchObject({ body: '{"a":1}', json: { a: 1 } });
    expect(receiver.requests[0].headers).toMatchObject({ 'x-test': 'yes', 'content-type': 'application/json' });
  });

  it('does not follow a redirect', async () => {
    receiver.answerWith((_request, response) => {
      response.writeHead(307, { location: `${receiver.url}/elsewhere` });
      response.end();
    });

    await expect(post()).rejects.toThrow(
      new OutboundRequestError('answered with a redirect (307), which is not followed'),
    );
    expect(receiver.requests.map((request) => request.path)).toEqual(['/hook']);
  });

  it('refuses an answer declared larger than the limit', async () => {
    receiver.answerWith(json(200, { padding: 'x'.repeat(OUTBOUND_MAX_RESPONSE_BYTES) }));

    await expect(post()).rejects.toThrow(`answered with more than ${OUTBOUND_MAX_RESPONSE_BYTES} bytes`);
  });

  it('stops reading a streamed answer once it passes the limit', async () => {
    receiver.answerWith((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      for (let chunk = 0; chunk < 20; chunk++) response.write('x'.repeat(8 * 1024));
      response.end();
    });

    await expect(post()).rejects.toThrow(`answered with more than ${OUTBOUND_MAX_RESPONSE_BYTES} bytes`);
  });

  it('gives up on an answer that takes longer than the timeout', async () => {
    receiver.answerWith(() => undefined);

    await expect(post({ timeoutMs: 100 })).rejects.toThrow(new OutboundRequestError('no answer within 100 ms'));
  });

  it('stops when the call is cancelled', async () => {
    receiver.answerWith(() => undefined);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(post({ signal: controller.signal })).rejects.toThrow('the tool call was cancelled');
  });

  it('reports an unreachable system without its URL', async () => {
    const url = receiver.url;
    await receiver.close();

    const failure = postJson({ url, body: '{}', headers: {} });
    await expect(failure).rejects.toThrow(/^the request failed \(\w+\)$/);
    await expect(failure).rejects.not.toThrow('127.0.0.1');
    receiver = await startApprovalReceiver();
  });
});
