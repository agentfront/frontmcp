import type { ExecutorContext } from '../executor-context.js';
import { execSync } from 'child_process';
import type { BuildExecExecutorSchema } from './schema.js';

export default async function buildExecExecutor(
  options: BuildExecExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args: string[] = ['npx', 'frontmcp', 'build', '--exec'];
  if (options.entry) args.push('--entry', options.entry);
  if (options.outputPath) args.push('--out-dir', options.outputPath);

  const command = args.join(' ');
  console.log(`Running: ${command}`);

  try {
    execSync(command, {
      cwd: context.root,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
