import { JobEnclaveBridge } from '../job-enclave.bridge';

// The browser and worker builds resolve `#enclave-core` to this stub.
jest.mock('#enclave-core', () => jest.requireActual('../browser-enclave-core'));

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof JobEnclaveBridge>[0];

describe('JobEnclaveBridge in the browser and worker builds', () => {
  it('refuses a dynamic job, saying it needs Node.js, without loading @enclave-vm/core', async () => {
    const enclaveCoreLoaded = jest.fn();
    jest.doMock('@enclave-vm/core', () => {
      enclaveCoreLoaded();
      return {};
    });

    await expect(new JobEnclaveBridge(logger).execute('return 1;', {}, {})).rejects.toThrow(
      'Dynamic jobs need Node.js: @enclave-vm/core, the sandbox they run in, does not run in a browser or a Worker',
    );
    expect(enclaveCoreLoaded).not.toHaveBeenCalled();
  });
});
