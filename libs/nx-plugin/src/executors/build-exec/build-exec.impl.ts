import type { ExecutorContext } from '../executor-context.js';
import { runFrontmcp, toAbsolute } from '../frontmcp-cli.js';
import type { BuildExecExecutorSchema } from './schema.js';

export default async function buildExecExecutor(
  options: BuildExecExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args: string[] = ['build', '--target', 'node'];
  if (options.entry) args.push('--entry', toAbsolute(context, options.entry));
  if (options.outputPath) args.push('--out-dir', toAbsolute(context, options.outputPath));
  return runFrontmcp(context, args);
}
