import type { ExecutorContext } from '../executor-context.js';
import { spawn } from 'child_process';
import type { DevExecutorSchema } from './schema.js';

export default async function* devExecutor(
  options: DevExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean; baseUrl?: string }> {
  const args: string[] = ['frontmcp', 'dev'];
  if (options.entry) args.push('--entry', options.entry);
  if (options.port) args.push('--port', String(options.port));

  console.log(`Running: npx ${args.join(' ')}`);

  const child = spawn('npx', args, {
    cwd: context.root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: true,
  });

  yield { success: true, baseUrl: `http://localhost:${options.port ?? 3000}` };

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

  yield { success: exitCode === 0 };
}
