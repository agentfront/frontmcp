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

  it('refuses a URL-mode question with no elicitationId', async () => {
    const request = adapter.sendElicitRequest(1, 'Sign in', z.object({}), {
      mode: 'url',
      url: 'https://example.com/consent',
    });

    await expect(request).rejects.toThrow('elicitationId is required when mode is "url"');
  });
});
