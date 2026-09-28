// file: plugins/plugin-codecall/src/__tests__/enclave.service.namespace-fallback.spec.ts
//
// The sandbox refuses a whole `toolNamespaces` configuration over one name it can't bind. CodeCall
// leaves such names out; should the sandbox still refuse one (a rule a later version adds), the
// script runs without namespaces instead of failing, since `callTool()` always works.

import * as enclaveCore from '@enclave-vm/core';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import CodeCallConfig from '../providers/code-call.config';
import EnclaveService from '../services/enclave.service';

jest.mock('@enclave-vm/core', () => {
  const actual = jest.requireActual<typeof import('@enclave-vm/core')>('@enclave-vm/core');
  return {
    ...actual,
    Enclave: jest.fn((options: import('@enclave-vm/core').CreateEnclaveOptions) => {
      if (options.toolNamespaces?.['refused']) {
        throw new TypeError('Invalid toolNamespaces: namespace "refused" is a name this version refuses');
      }
      if (options.toolNamespaces?.['broken']) {
        throw new TypeError('something else');
      }
      return new actual.Enclave(options);
    }),
  };
});

describe('EnclaveService when the sandbox refuses the namespaces', () => {
  const service = new EnclaveService(new CodeCallConfig({ vm: { preset: 'secure', timeoutMs: 5000 } }));
  const environment = (toolNamespaces: Record<string, Record<string, string>>): CodeCallVmEnvironment => ({
    callTool: jest.fn().mockResolvedValue({ ok: true }),
    getTool: jest.fn(),
    toolNamespaces,
  });

  it('runs the script without namespaces', async () => {
    const result = await service.execute(
      "return await callTool('refused.run', {});",
      environment({ refused: { run: 'refused.run' } }),
    );

    expect(result).toMatchObject({ success: true, result: { ok: true } });
    expect(jest.mocked(enclaveCore.Enclave)).toHaveBeenCalledTimes(2);
    expect(jest.mocked(enclaveCore.Enclave).mock.calls[1]?.[0]?.toolNamespaces).toBeUndefined();
  });

  it('still throws any other construction error', async () => {
    await expect(service.execute('return 1;', environment({ broken: { run: 'broken.run' } }))).rejects.toThrow(
      'something else',
    );
  });
});
