import type { ExecutorContext } from '../executor-context.js';
import { spawn } from 'child_process';
import type { InspectorExecutorSchema } from './schema.js';

export default async function* inspectorExecutor(
  options: InspectorExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean }> {
  const args: string[] = ['frontmcp', 'inspector'];
  if (options.port !== undefined) args.push('--port', String(options.port));

  console.log(`Running: npx ${args.join(' ')}`);

  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd: context.root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  yield { success: true };

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
