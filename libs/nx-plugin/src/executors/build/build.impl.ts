import type { ExecutorContext } from '../executor-context.js';
import { runFrontmcp, toAbsolute } from '../frontmcp-cli.js';
import type { BuildExecutorSchema } from './schema.js';

export default async function buildExecutor(
  options: BuildExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args: string[] = ['build'];
  // `adapter` is the old spelling of `target`; the CLI has no `--adapter` flag.
  const target = options.target ?? options.adapter;
  if (target) args.push('--target', target);
  if (options.entry) args.push('--entry', toAbsolute(context, options.entry));
  if (options.outputPath) args.push('--out-dir', toAbsolute(context, options.outputPath));
  return runFrontmcp(context, args);
}
