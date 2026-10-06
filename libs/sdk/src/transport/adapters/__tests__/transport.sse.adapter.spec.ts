import { z } from '@frontmcp/lazy-zod';

import { InvalidInputError } from '../../../errors';
import { TransportSSEAdapter } from '../transport.sse.adapter';

describe('TransportSSEAdapter.sendElicitRequest', () => {
  const adapter = Object.create(TransportSSEAdapter.prototype) as TransportSSEAdapter;

  it('refuses a URL-mode question with no url before sending anything', async () => {
    const request = adapter.sendElicitRequest(1, 'Sign in', z.object({}), { mode: 'url', elicitationId: 'el-1' });

    await expect(request).rejects.toBeInstanceOf(InvalidInputError);
    await expect(request).rejects.toThrow('url is required when mode is "url"');
  });

  it('sends a URL-mode question with no elicitationId under a generated one', async () => {
    const sent: Array<{ params?: Record<string, unknown> }> = [];
    const sseAdapter = Object.create(TransportSSEAdapter.prototype) as TransportSSEAdapter;
    Object.defineProperty(sseAdapter, 'newRequestId', { get: () => 7 });
    Object.assign(sseAdapter, {
      key: { sessionId: 'session-1' },
      logger: { info: jest.fn() },
      transport: { send: async (message: { params?: Record<string, unknown> }) => sent.push(message) },
      cancelPendingElicit: async () => undefined,
      requireElicitStore: () => ({
        setPending: async () => undefined,
        subscribeResult: async (_id: string, onResult: (result: unknown) => void) => {
          onResult({ status: 'accept' });
          return async () => undefined;
        },
      }),
    });

    const answer = await sseAdapter.sendElicitRequest(1, 'Sign in', z.object({}), {
      mode: 'url',
      url: 'https://example.com/consent',
    });

    expect(answer).toEqual({ status: 'accept' });
    expect(sent[0]?.params).toEqual(
      expect.objectContaining({ mode: 'url', url: 'https://example.com/consent', elicitationId: 'elicit-7' }),
    );
  });
});
