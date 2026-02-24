import type { ExecutorContext } from '../executor-context.js';
import { spawn } from 'child_process';
import type { InspectorExecutorSchema } from './schema.js';

export default async function* inspectorExecutor(
  options: InspectorExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean }> {
  const args: string[] = ['frontmcp', 'inspector'];
  if (options.port) args.push('--port', String(options.port));

  console.log(`Running: npx ${args.join(' ')}`);

  const child = spawn('npx', args, {
    cwd: context.root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: true,
  });

  yield { success: true };

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

  yield { success: exitCode === 0 };
}
