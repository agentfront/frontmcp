import { z } from '@frontmcp/lazy-zod';

import { type FrontMcpContext } from '../../../context';
import { type ElicitOptions, type ElicitResult } from '../../elicitation.types';
import { performElicit, type ElicitHelperDeps } from '../elicit.helper';

const urlMode: ElicitOptions = { mode: 'url', url: 'https://billing.example/connect' };
const clientAnswer: ElicitResult = { status: 'accept', content: { token: 'from-client' } };

function depsWith(context: Partial<FrontMcpContext>): ElicitHelperDeps {
  return {
    sessionId: 'session-1',
    getClientCapabilities: () => ({ elicitation: { form: {}, url: {} } }),
    tryGetContext: () => context as FrontMcpContext,
    entryName: 'connect_billing',
    entryInput: {},
    elicitationEnabled: true,
  };
}

function transportAnswering(answer: ElicitResult): Partial<FrontMcpContext> {
  return { transport: { elicit: async () => answer } } as unknown as Partial<FrontMcpContext>;
}

describe('performElicit: an accepted URL-mode answer carries no content', () => {
  it('drops the content a session client sent with it', async () => {
    const result = await performElicit(depsWith(transportAnswering(clientAnswer)), 'Sign in', z.object({}), urlMode);

    expect(result).toStrictEqual({ status: 'accept' });
  });

  it('drops the content of an answer given through sendElicitationResult', async () => {
    const fallbackContext = {
      getPreResolvedElicitResult: () => clientAnswer,
      clearPreResolvedElicitResult: () => undefined,
    } as unknown as Partial<FrontMcpContext>;

    const result = await performElicit(depsWith(fallbackContext), 'Sign in', z.object({}), urlMode);

    expect(result).toStrictEqual({ status: 'accept' });
  });

  it('keeps the content of a form-mode answer', async () => {
    const formAnswer: ElicitResult = { status: 'accept', content: { confirmed: true } };

    const result = await performElicit(
      depsWith(transportAnswering(formAnswer)),
      'Proceed?',
      z.object({ confirmed: z.boolean() }),
    );

    expect(result).toStrictEqual(formAnswer);
  });
});
