import type { ExecutorContext } from '../executor-context.js';
import { spawn } from 'child_process';
import type { DevExecutorSchema } from './schema.js';

export default async function* devExecutor(
  options: DevExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean; baseUrl?: string }> {
  const args: string[] = ['frontmcp', 'dev'];
  if (options.entry) args.push('--entry', options.entry);
  if (options.port !== undefined) args.push('--port', String(options.port));

  console.log(`Running: npx ${args.join(' ')}`);

  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd: context.root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  yield { success: true, ...(options.port !== undefined && { baseUrl: `http://localhost:${options.port}` }) };

  try {
    const exitCode = await new Promise<number>((resolve) => {
      child.on('error', () => resolve(1));
      child.on('close', (code) => resolve(code ?? 1));
    });

    yield { success: exitCode === 0 };
  } finally {
    if (!child.killed) child.kill();
  }
}
