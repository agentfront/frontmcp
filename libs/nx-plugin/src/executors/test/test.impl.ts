import type { ExecutorContext } from '../executor-context.js';
import { runFrontmcp } from '../frontmcp-cli.js';
import type { TestExecutorSchema } from './schema.js';

export default async function testExecutor(
  options: TestExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args: string[] = ['test'];
  if (options.runInBand) args.push('--runInBand');
  if (options.watch) args.push('--watch');
  if (options.coverage) args.push('--coverage');
  if (options.verbose) args.push('--verbose');
  if (options.timeout) args.push('--timeout', String(options.timeout));
  return runFrontmcp(context, args);
}
