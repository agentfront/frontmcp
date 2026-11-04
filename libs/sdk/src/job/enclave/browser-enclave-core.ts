// The browser and worker builds' `#enclave-core`: the sandbox needs Node, so a page's bundler never resolves it
import type { importEnclaveCore as importEnclaveCoreOnNode } from './enclave-core';

export const importEnclaveCore: typeof importEnclaveCoreOnNode = async () => {
  throw new Error(
    'Dynamic jobs need Node.js: @enclave-vm/core, the sandbox they run in, does not run in a browser or a Worker',
  );
};
