import type { CodeCallVmEnvironment } from '../codecall.symbol';
import CodeCallConfig from '../providers/code-call.config';
import EnclaveService from '../services/enclave.service';
import { buildExecuteToolDescription } from '../tools/execute.schema';

/**
 * The sandbox stops a script that calls one tool too often in a short time (`[RAPID_ENUMERATION]`):
 * more than `vm.rapidEnumerationThreshold` calls (30 by default) within about 2 seconds, `parallel()`
 * calls included. `vm.rapidEnumerationOverrides` sets the limit per tool.
 */

const PARALLEL_32_CALLS = `const ids = [${Array.from({ length: 32 }, (_, i) => i).join(', ')}];
const rows = await parallel(ids, (id) => callTool('users:get', { id }));
return rows.length;`;

function environment(): CodeCallVmEnvironment {
  return {
    callTool: jest.fn(async () => ({ ok: true })),
    getTool: jest.fn(),
    console: undefined,
    mcpLog: jest.fn(),
    mcpNotify: jest.fn(),
  } as unknown as CodeCallVmEnvironment;
}

type VmOptions = NonNullable<ConstructorParameters<typeof CodeCallConfig>[0]>['vm'];

function runWith(vm: VmOptions) {
  return new EnclaveService(new CodeCallConfig({ vm })).execute(PARALLEL_32_CALLS, environment());
}

describe('calls to one tool in a short time', () => {
  it('stops a parallel() of 32 calls to one tool by default', async () => {
    const result = await runWith({ preset: 'secure' });

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/\[RAPID_ENUMERATION\]/);
  });

  it('runs it with vm.rapidEnumerationThreshold above 32', async () => {
    const result = await runWith({ preset: 'secure', rapidEnumerationThreshold: 40 });

    expect(result).toEqual(expect.objectContaining({ success: true, result: 32 }));
  });

  it('runs it with a vm.rapidEnumerationOverrides entry for the tool', async () => {
    const result = await runWith({ preset: 'secure', rapidEnumerationOverrides: { 'users:get': 40 } });

    expect(result).toEqual(expect.objectContaining({ success: true, result: 32 }));
  });

  it('still stops other tools at the default when only one tool is overridden', async () => {
    const result = await runWith({ preset: 'secure', rapidEnumerationOverrides: { 'orders:get': 40 } });

    expect(result.error?.message).toMatch(/\[RAPID_ENUMERATION\]/);
  });

  it('is named in the codecall:execute description', () => {
    const defaults = new CodeCallConfig().getAll().resolvedVm;
    const configured = new CodeCallConfig({ vm: { preset: 'secure', rapidEnumerationThreshold: 45 } }).getAll()
      .resolvedVm;

    expect(buildExecuteToolDescription(defaults)).toContain('30 calls to one tool per 2s');
    expect(buildExecuteToolDescription(configured)).toContain('45 calls to one tool per 2s');
  });
});
