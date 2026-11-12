/**
 * Completing an argument of a prompt or resource that declares `authorities` is refused while no
 * authorities engine is configured to check them, as reading or getting it is.
 */
import 'reflect-metadata';

import { AuthorityDeniedError } from '@frontmcp/auth';

import { createMockScopeEntry } from '../../../__test-utils__';
import CompleteFlow from '../complete.flow';

const passThrough = { parse: (value: unknown) => value } as never;

function makeFlow(state: Record<string, unknown>): CompleteFlow {
  const metadata = {
    name: 'completion:complete',
    plan: { pre: [], execute: [], finalize: [] },
    inputSchema: passThrough,
    outputSchema: passThrough,
    access: 'authorized',
  } as never;
  const rawInput = { request: { method: 'completion/complete', params: {} }, ctx: {} };
  const flow = new CompleteFlow(metadata, rawInput as never, createMockScopeEntry(), jest.fn(), new Map());
  for (const [key, value] of Object.entries(state)) flow.state.set(key as never, value as never);
  return flow;
}

const ADMIN_ONLY = { roles: { any: ['admin'] } };

describe('completion with no authorities engine configured', () => {
  it('refuses to complete for a prompt that declares authorities', async () => {
    const prompt = { name: 'audit-brief', fullName: 'books:audit-brief', metadata: { authorities: ADMIN_ONLY } };

    const check = makeFlow({ prompt }).checkEntryAuthorities();

    await expect(check).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(check).rejects.toThrow('Prompt "books:audit-brief": no authorities engine is configured');
  });

  it('refuses to complete for a resource template that declares authorities', async () => {
    const resource = { name: 'ledger', fullName: 'books:ledger', metadata: { authorities: ADMIN_ONLY } };

    await expect(makeFlow({ resource }).checkEntryAuthorities()).rejects.toThrow(
      'Resource "books:ledger": no authorities engine is configured',
    );
  });

  it('completes for a prompt that declares no authorities', async () => {
    const prompt = { name: 'summary', fullName: 'books:summary', metadata: {} };

    await expect(makeFlow({ prompt }).checkEntryAuthorities()).resolves.toBeUndefined();
  });
});
