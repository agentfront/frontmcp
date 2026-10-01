// file: plugins/plugin-codecall/src/__tests__/codecall-direct-call.spec.ts

/**
 * The gate that refuses a client's direct `tools/call` of a tool CodeCall hides (#678), and how it
 * tells an in-process dispatch from a client's call.
 */
import { getRunningTool, ToolNotFoundError, type FlowCtxOf } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import { asCodeCallDispatch, isInProcessDispatch } from '../security';

jest.mock('@frontmcp/sdk', () => ({
  ...jest.requireActual<typeof import('@frontmcp/sdk')>('@frontmcp/sdk'),
  getRunningTool: jest.fn(),
}));

const runningTool = getRunningTool as jest.MockedFunction<typeof getRunningTool>;

beforeEach(() => {
  runningTool.mockReturnValue(undefined);
});

type CallToolFlowCtx = FlowCtxOf<'tools:call-tool'>;

function flowCtxFor(
  tool: { name: string; fullName: string; owner?: { kind: string; id: string }; metadata?: Record<string, unknown> },
  ctx: unknown,
  requested?: string,
): CallToolFlowCtx {
  return {
    rawInput: { request: { method: 'tools/call', params: { name: requested ?? tool.name } }, ctx },
    state: { tool: { metadata: {}, ...tool }, input: requested ? { name: requested } : undefined },
  } as unknown as CallToolFlowCtx;
}

const hiddenTool = { name: 'users:list', fullName: 'crm:users:list', owner: { kind: 'app', id: 'crm' } };

describe('isInProcessDispatch', () => {
  it('is false for a client call context', () => {
    expect(isInProcessDispatch({ authInfo: {}, surface: 'mcp' })).toBe(false);
  });

  it.each([undefined, null, 'ctx'])('is false for a call context of %p', (ctx) => {
    expect(isInProcessDispatch(ctx)).toBe(false);
  });

  it("is true for CodeCall's own dispatch", () => {
    expect(isInProcessDispatch(asCodeCallDispatch({ authInfo: {}, surface: 'mcp' }))).toBe(true);
  });

  it("is true for the SDK's trusted in-process dispatch", () => {
    expect(isInProcessDispatch({ authInfo: {}, internalCall: true })).toBe(true);
  });

  it('is true inside a running tool', () => {
    runningTool.mockReturnValue({ name: 'sendElicitationResult', fullName: 'sendElicitationResult' });
    expect(isInProcessDispatch({})).toBe(true);
  });

  it('is not carried by a copied JSON context', () => {
    const marked = asCodeCallDispatch({ surface: 'mcp' });
    expect(isInProcessDispatch(JSON.parse(JSON.stringify(marked)))).toBe(false);
  });
});

describe('CodeCallPlugin.refuseDirectCallOfHiddenTool', () => {
  function pluginFor(mode: 'codecall_only' | 'codecall_opt_in' | 'metadata_driven' = 'codecall_only') {
    const plugin = new CodeCallPlugin({ mode });
    const logger = { verbose: jest.fn(), child: () => logger };
    jest.spyOn(plugin, 'get').mockReturnValue(logger as never);
    return plugin;
  }

  it("refuses a client's direct call of a hidden tool as an unknown tool, by the name it used", async () => {
    const refusal = pluginFor().refuseDirectCallOfHiddenTool(flowCtxFor(hiddenTool, { surface: 'mcp' }, 'crm:users:list'));

    await expect(refusal).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(refusal).rejects.toThrow('Tool "crm:users:list" not found');
  });

  it("names the tool's own name when the requested name is not in the state", async () => {
    await expect(pluginFor().refuseDirectCallOfHiddenTool(flowCtxFor(hiddenTool, {}))).rejects.toThrow(
      'Tool "users:list" not found',
    );
  });

  it('lets an in-process dispatch through', async () => {
    const ctx = flowCtxFor(hiddenTool, asCodeCallDispatch({ surface: 'mcp' }));
    await expect(pluginFor().refuseDirectCallOfHiddenTool(ctx)).resolves.toBeUndefined();
  });

  it('lets a listed tool through', async () => {
    const listed = { ...hiddenTool, metadata: { codecall: { visibleInListTools: true } } };
    await expect(pluginFor().refuseDirectCallOfHiddenTool(flowCtxFor(listed, {}))).resolves.toBeUndefined();
  });

  it('lets every default tool through in codecall_opt_in mode', async () => {
    await expect(pluginFor('codecall_opt_in').refuseDirectCallOfHiddenTool(flowCtxFor(hiddenTool, {}))).resolves.toBeUndefined();
  });

  it("never refuses the server's own system tools", async () => {
    const systemTool = { name: 'sendElicitationResult', fullName: 'sendElicitationResult', owner: { kind: 'scope', id: '_system' } };
    await expect(pluginFor().refuseDirectCallOfHiddenTool(flowCtxFor(systemTool, {}))).resolves.toBeUndefined();
  });

  it('does nothing before the tool is known', async () => {
    const ctx = { rawInput: undefined, state: {} } as unknown as CallToolFlowCtx;
    await expect(pluginFor().refuseDirectCallOfHiddenTool(ctx)).resolves.toBeUndefined();
  });

  it('refuses a call with no call context', async () => {
    const ctx = { rawInput: undefined, state: { tool: { metadata: {}, ...hiddenTool } } } as unknown as CallToolFlowCtx;
    await expect(pluginFor().refuseDirectCallOfHiddenTool(ctx)).rejects.toBeInstanceOf(ToolNotFoundError);
  });
});
