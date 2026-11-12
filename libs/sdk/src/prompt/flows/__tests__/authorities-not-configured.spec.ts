/**
 * A prompt that declares `authorities` is never served while no authorities engine is configured to
 * check them: prompts/get is refused, saying what to configure, and prompts/list leaves it out.
 */
import 'reflect-metadata';

import { AuthorityDeniedError } from '@frontmcp/auth';

import { createMockScopeEntry } from '../../../__test-utils__';
import GetPromptFlow from '../get-prompt.flow';
import PromptsListFlow from '../prompts-list.flow';

const passThrough = { parse: (value: unknown) => value } as never;

/** A flow of `FlowClass` on a scope with no authorities engine, with `state` set. */
function makeFlow<FlowClass extends new (...args: never[]) => { state: { set(key: string, value: unknown): void } }>(
  FlowClass: FlowClass,
  flowName: string,
  state: Record<string, unknown>,
): InstanceType<FlowClass> {
  const metadata = {
    name: flowName,
    plan: { pre: [], execute: [], finalize: [] },
    inputSchema: passThrough,
    outputSchema: passThrough,
    access: 'authorized',
  };
  const rawInput = { request: { method: 'prompts/get', params: {} }, ctx: {} };
  const Constructor = FlowClass as unknown as new (...args: unknown[]) => InstanceType<FlowClass>;
  const flow = new Constructor(metadata, rawInput, createMockScopeEntry(), jest.fn(), new Map());
  for (const [key, value] of Object.entries(state)) flow.state.set(key, value);
  return flow;
}

const ADMIN_ONLY = { roles: { any: ['admin'] } };
const auditBrief = {
  name: 'audit-brief',
  fullName: 'books:audit-brief',
  metadata: { name: 'audit-brief', authorities: ADMIN_ONLY },
};
const summary = { name: 'summary', fullName: 'books:summary', metadata: { name: 'summary' } };

describe('prompt authorities with no engine configured to check them', () => {
  it('refuses a prompt that declares authorities, saying what to configure', async () => {
    const flow = makeFlow(GetPromptFlow, 'prompts:get-prompt', { prompt: auditBrief, authInfo: {} });

    const check = flow.checkEntryAuthorities();

    await expect(check).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(check).rejects.toThrow(
      `Access denied to Prompt "books:audit-brief": no authorities engine is configured (add 'authorities' to @FrontMcp())`,
    );
  });

  it('still serves a prompt that declares no authorities', async () => {
    const flow = makeFlow(GetPromptFlow, 'prompts:get-prompt', { prompt: summary, authInfo: {} });

    await expect(flow.checkEntryAuthorities()).resolves.toBeUndefined();
  });

  it('leaves the prompts that declare authorities out of prompts/list', async () => {
    const prompts = [
      { ownerName: 'books', prompt: auditBrief },
      { ownerName: 'books', prompt: summary },
    ];
    const flow = makeFlow(PromptsListFlow, 'prompts:list-prompts', { prompts });

    await flow.filterByAuthorities();

    expect(flow.state.required.prompts.map((item: { prompt: { name: string } }) => item.prompt.name)).toEqual([
      'summary',
    ]);
  });
});
