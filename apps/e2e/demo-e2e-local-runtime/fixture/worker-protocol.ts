/**
 * The worker side of `e2e/helpers/workers.ts`: a worker prints lines on stdout and reads its
 * instructions from stdin, so a spec can start many workers at once and wait for each one.
 */

/** Print a line the spec waits for with `worker.waitFor(line)`. */
export function signal(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Resolve once the spec sends `line` with `worker.send(line)`; stdin keeps the worker alive only meanwhile. */
export function waitForLine(line: string): Promise<void> {
  return new Promise((resolve) => {
    let buffered = '';
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      if (!buffered.split('\n').includes(line)) return;
      process.stdin.off('data', onData);
      process.stdin.unref();
      resolve();
    };
    process.stdin.ref();
    process.stdin.on('data', onData);
  });
}

/** Print `ready`, then wait for the spec's `go`, so every worker starts at the same moment. */
export async function readyThenWaitForGo(): Promise<void> {
  signal('ready');
  await waitForLine('go');
}

/** Print the result the spec reads from `worker.result`. */
export function report(result: unknown): void {
  signal(`result ${JSON.stringify(result)}`);
}

/** Run `main`, and exit with code 1 after printing the error when it fails. */
export function runWorker(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`worker: ${name} is not set`);
  return value;
}
