import type { ExecutorContext } from '../executor-context.js';
import { spawn } from 'child_process';
import type { ServeExecutorSchema } from './schema.js';

export default async function* serveExecutor(
  options: ServeExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean }> {
  const projectName = context.projectName ?? '';
  const args: string[] = ['frontmcp', 'start', projectName];
  if (options.entry) args.push('--entry', options.entry);
  if (options.port) args.push('--port', String(options.port));
  if (options.maxRestarts !== undefined) args.push('--max-restarts', String(options.maxRestarts));

  console.log(`Running: npx ${args.join(' ')}`);

  const child = spawn('npx', args, {
    cwd: context.root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: true,
  });

  yield { success: true };

  await new Promise<void>((resolve) => {
    child.on('close', () => resolve());
  });

  yield { success: true };
}
