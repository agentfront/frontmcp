import type { ExecutorContext } from '../executor-context.js';
import { execSync } from 'child_process';
import type { TestExecutorSchema } from './schema.js';

export default async function testExecutor(
  options: TestExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args: string[] = ['npx', 'frontmcp', 'test'];
  if (options.runInBand) args.push('--runInBand');
  if (options.watch) args.push('--watch');
  if (options.coverage) args.push('--coverage');
  if (options.verbose) args.push('--verbose');
  if (options.timeout) args.push('--timeout', String(options.timeout));

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
