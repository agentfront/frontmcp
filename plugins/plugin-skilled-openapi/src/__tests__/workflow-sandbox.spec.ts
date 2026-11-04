import { runInNewContext } from 'node:vm';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { loadWorkflowSandbox, splitCallOptions, type WorkflowSandbox } from '../executor/workflow-sandbox';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

type SandboxRun = { sandbox: string; options: unknown; program: string; disposed: boolean };
const mockRuns: SandboxRun[] = [];
let mockBrowserEnclaveMissing = false;

jest.mock('@enclave-vm/browser', () => {
  if (mockBrowserEnclaveMissing) throw new Error('Cannot find module @enclave-vm/browser');
  return {
    BrowserEnclave: class {
      private readonly record: SandboxRun;
      constructor(options: unknown) {
        this.record = { sandbox: 'BrowserEnclave', options, program: '', disposed: false };
        mockRuns.push(this.record);
      }
      async run(program: string) {
        this.record.program = program;
        return { success: true, value: 'from the page', stats: { duration: 1, toolCallCount: 0, iterationCount: 0 } };
      }
      dispose() {
        this.record.disposed = true;
      }
    },
  };
});
jest.mock('@enclave-vm/core/worker', () => ({
  InterpreterAdapter: class {
    constructor(private readonly options: unknown) {}
    async execute(program: string, context: { config: unknown }) {
      mockRuns.push({
        sandbox: 'InterpreterAdapter',
        options: [this.options, context.config],
        program,
        disposed: false,
      });
      return {
        success: true,
        value: 'from the interpreter',
        stats: { duration: 1, toolCallCount: 0, iterationCount: 0 },
      };
    }
  },
}));

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

function runIn(place: 'node' | 'browser worker' | 'browser page'): void {
  if (place !== 'node') runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser' }));
  if (place === 'browser page') (globalThis as { document?: unknown }).document = {};
}

async function sandboxFor(place: 'node' | 'browser worker' | 'browser page'): Promise<WorkflowSandbox> {
  runIn(place);
  const sandbox = await loadWorkflowSandbox();
  if ('unavailable' in sandbox) throw new Error(sandbox.unavailable);
  return sandbox;
}

/** The `callTool` calls a compiled browser program makes, run in a context whose `callTool` records them. */
async function callsOf(program: string): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const callTool = async (...args: unknown[]) => {
    calls.push(args);
    return { id: '7' };
  };
  await runInNewContext(`${program}\n__ag_main();`, { callTool });
  return JSON.parse(JSON.stringify(calls));
}

beforeEach(() => {
  mockRuns.length = 0;
  mockBrowserEnclaveMissing = false;
});

afterEach(() => {
  runtimeContext.mockImplementation(realRuntimeContext);
  delete (globalThis as { document?: unknown }).document;
  jest.resetModules();
});

describe('the workflow sandbox', () => {
  it('runs a script in the BrowserEnclave in a browser page, with the 25-call and 8-second limits, and disposes it', async () => {
    const sandbox = await sandboxFor('browser page');
    const result = await sandbox.run(await sandbox.compile('return 1;'), async () => undefined);

    expect(result.value).toBe('from the page');
    expect(mockRuns).toEqual([
      {
        sandbox: 'BrowserEnclave',
        options: { timeout: 8_000, maxToolCalls: 25 },
        program: expect.stringContaining('async function __ag_main()'),
        disposed: true,
      },
    ]);
  });

  it.each(['node', 'browser worker'] as const)('runs a script in the interpreter on %s', async (place) => {
    const sandbox = await sandboxFor(place);
    const result = await sandbox.run(await sandbox.compile('return 1;'), async () => undefined);

    expect(result.value).toBe('from the interpreter');
    expect(mockRuns).toEqual([
      {
        sandbox: 'InterpreterAdapter',
        options: [{ maxSteps: 2_000_000 }, { maxToolCalls: 25, timeout: 8_000 }],
        program: expect.stringMatching(/^async function callTool\(actionId, input, options\)/),
        disposed: false,
      },
    ]);
  });

  it('names @enclave-vm/browser when a browser page does not have it', async () => {
    mockBrowserEnclaveMissing = true;
    runIn('browser page');

    expect(await loadWorkflowSandbox()).toEqual({
      unavailable:
        'workflow execution unavailable: the @enclave-vm sandbox is not installed. Install @enclave-vm/browser and @enclave-vm/ast to enable run_workflow.',
    });
  });

  it("moves a call's options into its input in a browser page, where the sandbox hands the handler only the input", async () => {
    const sandbox = await sandboxFor('browser page');
    const program = await sandbox.compile(`
      const invoice = await callTool("getInvoice", { id: "7" }, { throwOnError: false });
      const owner = await callTool("getCustomer", { id: (await callTool("getInvoice", { id: "8" }, { throwOnError: true })).id });
      return [invoice, owner];
    `);

    expect(await callsOf(program)).toEqual([
      ['getInvoice', { id: '7', __callToolOptions: { throwOnError: false } }],
      ['getInvoice', { id: '8', __callToolOptions: { throwOnError: true } }],
      ['getCustomer', { id: '7' }],
    ]);
    expect(splitCallOptions({ id: '7', __callToolOptions: { throwOnError: false } })).toEqual({
      input: { id: '7' },
      throwOnError: false,
    });
  });

  it.each(['node', 'browser page'] as const)('refuses a script that does not parse on %s', async (place) => {
    const sandbox = await sandboxFor(place);
    await expect(sandbox.compile('return {')).rejects.toThrow(/Failed to parse AgentScript code/);
  });
});
