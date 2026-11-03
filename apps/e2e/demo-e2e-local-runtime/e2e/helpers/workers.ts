/** Start fixture scripts that follow `fixture/worker-protocol.ts` and drive them line by line from a spec. */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = join(__dirname, '..', '..');

export interface Worker<Result> {
  readonly child: ChildProcess;
  /** Every complete line the worker printed so far. */
  readonly lines: readonly string[];
  /** Resolves when the worker prints `line`; rejects if it exits first. */
  waitFor(line: string): Promise<void>;
  send(line: string): void;
  /** What the worker reported; rejects when it exits with a code other than 0. */
  readonly result: Promise<Result>;
}

/** Run `fixture/<script>` with tsx from source, with `env` added to this process's environment. */
export function spawnWorker<Result>(script: string, env: Record<string, string> = {}): Worker<Result> {
  const child = spawn(process.execPath, ['--import', 'tsx', join(projectRoot, 'fixture', script)], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  const waiters: { line: string; resolve: () => void }[] = [];
  let pending = '';
  let stderr = '';

  child.stdin?.on('error', () => undefined);
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const complete = pending.split('\n');
    pending = complete.pop() ?? '';
    for (const line of complete) {
      lines.push(line);
      for (const waiter of waiters.filter((candidate) => candidate.line === line)) waiter.resolve();
    }
  });

  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });

  const result = exited.then((code) => {
    const reported = lines.find((line) => line.startsWith('result '));
    if (code !== 0 || !reported) {
      throw new Error(`worker ${script} exited with ${code}${reported ? '' : ' without a result'}:\n${stderr}`);
    }
    return JSON.parse(reported.slice('result '.length)) as Result;
  });
  result.catch(() => undefined);

  return {
    child,
    lines,
    result,
    send: (line) => child.stdin?.write(`${line}\n`),
    waitFor: (line) =>
      lines.includes(line)
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            waiters.push({ line, resolve });
            void exited.then((code) =>
              reject(new Error(`worker ${script} exited with ${code} before "${line}":\n${stderr}`)),
            );
          }),
  };
}

/** Wait until every worker is ready, start them all at once, and collect what they report. */
export async function runTogether<Result>(workers: Worker<Result>[]): Promise<Result[]> {
  await Promise.all(workers.map((worker) => worker.waitFor('ready')));
  for (const worker of workers) worker.send('go');
  return Promise.all(workers.map((worker) => worker.result));
}

/** Kill the workers still running, so a failed spec does not leave processes behind. */
export function killAll(workers: Worker<unknown>[]): void {
  for (const { child } of workers) if (child.exitCode === null) child.kill('SIGKILL');
}
