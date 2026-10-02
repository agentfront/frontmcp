import { importWithRequireFallback } from '../dynamic-import.utils';

describe('importWithRequireFallback (issue #680)', () => {
  it('uses the dynamic import when it works and never calls require', async () => {
    const requireFallback = jest.fn(() => ({ from: 'require' }));
    const mod = await importWithRequireFallback(async () => ({ from: 'import' }), requireFallback);
    expect(mod).toEqual({ from: 'import' });
    expect(requireFallback).not.toHaveBeenCalled();
  });

  it("falls back to require when the runtime refuses the dynamic import (Jest's VM without the flag)", async () => {
    const vmError = Object.assign(new TypeError('A dynamic import callback was invoked without --experimental-vm-modules'), {
      code: 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG',
    });
    const mod = await importWithRequireFallback(
      () => Promise.reject(vmError),
      () => ({ from: 'require' }),
    );
    expect(mod).toEqual({ from: 'require' });
  });

  it('rethrows the original import error when require fails too (a missing package stays reported as missing)', async () => {
    const importError = new Error("Cannot find package 'nope'");
    await expect(
      importWithRequireFallback(
        () => Promise.reject(importError),
        () => {
          throw new ReferenceError('require is not defined');
        },
      ),
    ).rejects.toBe(importError);
  });
});
