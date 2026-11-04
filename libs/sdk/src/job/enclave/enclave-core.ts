/** @enclave-vm/core, the optional peer dynamic jobs run in: its full sandbox uses Node's `worker_threads` and `node:vm`. */
export async function importEnclaveCore(): Promise<unknown> {
  try {
    return await import('@enclave-vm/core');
  } catch {
    throw new Error(
      'Missing optional dependency: dynamic jobs require @enclave-vm/core. Install it with: npm install @enclave-vm/core',
    );
  }
}
