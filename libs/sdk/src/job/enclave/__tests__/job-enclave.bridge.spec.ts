import { JobEnclaveBridge } from '../job-enclave.bridge';

const runCalls: Array<{ script: string; globals: Record<string, unknown> }> = [];
const sandboxLifecycle: string[] = [];

jest.mock('@enclave-vm/core', () => ({
  Sandbox: class MockSandbox {
    constructor() {
      sandboxLifecycle.push('constructed');
    }
    async run(script: string, globals: Record<string, unknown>): Promise<unknown> {
      runCalls.push({ script, globals });
      return 'done';
    }
    dispose(): void {
      sandboxLifecycle.push('disposed');
    }
  },
}));

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ConstructorParameters<typeof JobEnclaveBridge>[0];
}

async function capturedGlobals(context: Parameters<JobEnclaveBridge['execute']>[2]): Promise<Record<string, unknown>> {
  const bridge = new JobEnclaveBridge(createLogger());
  await bridge.execute('return 1;', { a: 1 }, context);
  return runCalls[runCalls.length - 1].globals;
}

beforeEach(() => {
  runCalls.length = 0;
  sandboxLifecycle.length = 0;
});

describe('JobEnclaveBridge', () => {
  it('passes a copy of the input rather than the caller object', async () => {
    const bridge = new JobEnclaveBridge(createLogger());
    const input = { nested: { n: 1 } };

    await bridge.execute('return input;', input, {});

    const passed = runCalls[0].globals['input'] as typeof input;
    expect(passed).toEqual(input);
    expect(passed).not.toBe(input);
    expect(passed.nested).not.toBe(input.nested);
  });

  it('rejects a non-cloneable input without constructing a sandbox', async () => {
    const bridge = new JobEnclaveBridge(createLogger());

    // A function cannot be structured-cloned. Failing before the sandbox exists means there is
    // nothing left undisposed.
    await expect(bridge.execute('return input;', { callback: () => 1 }, {})).rejects.toThrow(
      /not structured-cloneable/,
    );
    expect(sandboxLifecycle).toEqual([]);
  });

  it('preserves cycles and Map/Set in the input (structured-clone, not JSON)', async () => {
    const bridge = new JobEnclaveBridge(createLogger());
    const input: Record<string, unknown> = { tags: new Set(['a']), lookup: new Map([['k', 1]]) };
    input['self'] = input;

    await bridge.execute('return input;', input, {});

    const passed = runCalls[0].globals['input'] as Record<string, unknown>;
    expect(passed['self']).toBe(passed);
    // structuredClone returns cross-realm objects under jest, so assert the behaviour rather
    // than identity against this realm's constructors.
    expect(Object.prototype.toString.call(passed['tags'])).toBe('[object Set]');
    expect(Object.prototype.toString.call(passed['lookup'])).toBe('[object Map]');
    expect((passed['tags'] as Set<string>).has('a')).toBe(true);
    expect((passed['lookup'] as Map<string, number>).get('k')).toBe(1);
  });

  it('disposes the sandbox after a successful run', async () => {
    const bridge = new JobEnclaveBridge(createLogger());

    await bridge.execute('return 1;', { a: 1 }, {});

    expect(sandboxLifecycle).toEqual(['constructed', 'disposed']);
  });

  it('hands callTool results to the sandbox as plain copies', async () => {
    const hostResult = { rows: [{ id: 1 }] };
    const globals = await capturedGlobals({ callTool: async () => hostResult });

    const callTool = globals['callTool'] as (name: string, args: unknown) => Promise<unknown>;
    const received = (await callTool('x', {})) as typeof hostResult;

    expect(received).toEqual(hostResult);
    expect(received).not.toBe(hostResult);
    expect(received.rows).not.toBe(hostResult.rows);
  });

  it('hands getTool results to the sandbox as plain copies', async () => {
    const hostMeta = { name: 't', inputSchema: { type: 'object' } };
    const globals = await capturedGlobals({ getTool: () => hostMeta });

    const getTool = globals['getTool'] as (name: string) => unknown;
    const received = getTool('t') as typeof hostMeta;

    expect(received).toEqual(hostMeta);
    expect(received).not.toBe(hostMeta);
    expect(received.inputSchema).not.toBe(hostMeta.inputSchema);
  });

  it('strips the prototype of a class instance returned by getTool', async () => {
    class HostSchema {
      readonly type = 'object';
      parse(): void {
        /* noop */
      }
    }
    const globals = await capturedGlobals({ getTool: () => new HostSchema() });

    const getTool = globals['getTool'] as (name: string) => Record<string, unknown>;
    const received = getTool('t');

    expect(received).toEqual({ type: 'object' });
    expect(received instanceof HostSchema).toBe(false);
    expect(received['parse']).toBeUndefined();
  });

  it('rejects a getTool result that cannot be represented as plain data', async () => {
    const globals = await capturedGlobals({ getTool: () => ({ run: () => 'host' }) });

    const getTool = globals['getTool'] as (name: string) => unknown;

    expect(() => getTool('t')).toThrow(expect.objectContaining({ type: 'ToolError' }));
  });

  it('rejects a callTool result that cannot be represented as plain data', async () => {
    const globals = await capturedGlobals({ callTool: async () => ({ run: () => 'host' }) });

    const callTool = globals['callTool'] as (name: string, args: unknown) => Promise<unknown>;

    await expect(callTool('x', {})).rejects.toEqual(expect.objectContaining({ type: 'ToolError' }));
  });
});
