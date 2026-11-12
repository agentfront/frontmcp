/**
 * An entry that declares `authorities` is never served while no authorities engine is configured to
 * check them. The server refuses to start that way for the entries it knows at startup; an entry
 * published later (a channel's tool, an ESM app's new version, a tool an agent's private scope holds)
 * met a stage that skipped the check and ran for every caller. The call is now refused, and the
 * listing leaves the entry out.
 */
import 'reflect-metadata';

import { AuthorityDeniedError } from '@frontmcp/auth';

import { createMockScopeEntry } from '../../../__test-utils__';
import CallAgentFlow from '../../../agent/flows/call-agent.flow';
import CallToolFlow from '../call-tool.flow';
import ToolsListFlow from '../tools-list.flow';

const passThrough = { parse: (value: unknown) => value } as any;

/** A flow of `FlowClass` on a scope with no authorities engine, with `state` set. */
function makeFlow<FlowClass extends new (...args: any[]) => any>(
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
  const rawInput = { request: { method: 'tools/call', params: {} }, ctx: {} };
  const flow = new FlowClass(metadata, rawInput, createMockScopeEntry(), jest.fn(), new Map());
  for (const [key, value] of Object.entries(state)) flow.state.set(key, value);
  return flow;
}

const ADMIN_ONLY = { roles: { any: ['admin'] } };
const protectedTool = { name: 'wipe_disk', fullName: 'ops:wipe_disk', metadata: { authorities: ADMIN_ONLY } };
const openTool = { name: 'read_disk', fullName: 'ops:read_disk', metadata: {} };

describe('authorities with no engine configured to check them', () => {
  it('refuses a call to a tool that declares authorities, saying what to configure', async () => {
    const flow = makeFlow(CallToolFlow, 'tools:call-tool', { tool: protectedTool, authInfo: {} });

    const check = flow.checkEntryAuthorities();

    await expect(check).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(check).rejects.toThrow(
      `Access denied to Tool "ops:wipe_disk": no authorities engine is configured (add 'authorities' to @FrontMcp())`,
    );
  });

  it('still runs a tool that declares no authorities', async () => {
    const flow = makeFlow(CallToolFlow, 'tools:call-tool', { tool: openTool, authInfo: {} });

    await expect(flow.checkEntryAuthorities()).resolves.toBeUndefined();
  });

  it('refuses a call to an agent that declares authorities', async () => {
    const agent = { name: 'refunds', fullName: 'desk:refunds', metadata: { authorities: ADMIN_ONLY } };
    const flow = makeFlow(CallAgentFlow, 'agents:call-agent', { agent, authInfo: {} });

    await expect(flow.checkEntryAuthorities()).rejects.toBeInstanceOf(AuthorityDeniedError);
  });

  it('leaves the tools that declare authorities out of tools/list', async () => {
    const tools = [
      { appName: 'ops', tool: protectedTool },
      { appName: 'ops', tool: openTool },
    ];
    const flow = makeFlow(ToolsListFlow, 'tools:list-tools', { tools, authInfo: {} });

    await flow.filterByAuthorities();

    expect(flow.state.required.tools.map((item: { tool: { name: string } }) => item.tool.name)).toEqual(['read_disk']);
  });
});
