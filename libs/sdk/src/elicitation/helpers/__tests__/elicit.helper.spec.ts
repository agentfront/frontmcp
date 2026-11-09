import { z } from '@frontmcp/lazy-zod';

import { FrontMcpContext } from '../../../context';
import { ElicitationFallbackRequired, InvalidInputError } from '../../../errors';
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

function transportAnswering(answer: ElicitResult): FrontMcpContext {
  const context = new FrontMcpContext({ sessionId: 'session-1', scopeId: 'scope-1' });
  context.setTransport({
    type: 'streamable-http',
    jsonRpcRequestId: 1,
    sendElicitRequest: async () => answer,
  } as unknown as Parameters<FrontMcpContext['setTransport']>[0]);
  return context;
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

describe('performElicit: an empty elicitationId counts as left out', () => {
  it('generates the id of a URL-mode question', async () => {
    const sentOptions: Array<ElicitOptions | undefined> = [];
    const context = {
      transport: {
        elicit: async (_message: string, _schema: unknown, options?: ElicitOptions) => {
          sentOptions.push(options);
          return { status: 'accept' };
        },
      },
    } as unknown as Partial<FrontMcpContext>;

    await performElicit(depsWith(context), 'Sign in', z.object({}), { ...urlMode, elicitationId: '' });

    expect(sentOptions[0]?.elicitationId).toMatch(/^elicit-/);
  });

  it('generates the id of a fallback question', async () => {
    const deps = { ...depsWith({}), getClientCapabilities: () => ({}) };

    const asking = performElicit(deps, 'Proceed?', z.object({ confirmed: z.boolean() }), { elicitationId: '' });

    await expect(asking).rejects.toBeInstanceOf(ElicitationFallbackRequired);
    await expect(asking).rejects.toMatchObject({ elicitId: expect.stringMatching(/^elicit-/) });
  });
});

describe('performElicit: an answer reaches the caller only as the requested schema reads it', () => {
  const confirmSchema = z.object({ confirm: z.boolean() });
  const wrongType: ElicitResult = { status: 'accept', content: { confirm: 'yes' } };

  function preResolved(answer: ElicitResult): Partial<FrontMcpContext> {
    return {
      getPreResolvedElicitResult: () => answer,
      clearPreResolvedElicitResult: () => undefined,
    } as unknown as Partial<FrontMcpContext>;
  }

  function mrtrAnswering(answer: ElicitResult): Partial<FrontMcpContext> {
    return {
      getMrtrExchange: () => ({ clientDeclaredRevision: true, resolveElicitation: () => answer }),
    } as unknown as Partial<FrontMcpContext>;
  }

  it('refuses a session answer that does not match the schema', async () => {
    const asking = performElicit(depsWith(transportAnswering(wrongType)), 'Proceed?', confirmSchema);

    await expect(asking).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('refuses an answer given through sendElicitationResult that does not match the schema', async () => {
    const asking = performElicit(depsWith(preResolved(wrongType)), 'Proceed?', confirmSchema);

    await expect(asking).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('hands over the parsed content of a matching session answer', async () => {
    const answer: ElicitResult = { status: 'accept', content: { confirm: true, extra: 'dropped' } };

    const result = await performElicit(depsWith(transportAnswering(answer)), 'Proceed?', confirmSchema);

    expect(result).toStrictEqual({ status: 'accept', content: { confirm: true } });
  });

  it.each<[string, Partial<FrontMcpContext>]>([
    ['a session', transportAnswering({ status: 'decline', content: { confirm: 'yes' } })],
    ['sendElicitationResult', preResolved({ status: 'decline', content: { confirm: 'yes' } })],
    ['MCP 2026-07-28', mrtrAnswering({ status: 'decline', content: { confirm: 'yes' } })],
  ])('drops the content of a declined answer from %s', async (_label, context) => {
    const result = await performElicit(depsWith(context), 'Proceed?', confirmSchema);

    expect(result).toStrictEqual({ status: 'decline' });
  });

  it('drops the content of a cancelled answer', async () => {
    const answer: ElicitResult = { status: 'cancel', content: { confirm: true } };

    const result = await performElicit(depsWith(transportAnswering(answer)), 'Proceed?', confirmSchema);

    expect(result).toStrictEqual({ status: 'cancel' });
  });
});
