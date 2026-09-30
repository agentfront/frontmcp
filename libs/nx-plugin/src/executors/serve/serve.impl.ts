import type { ExecutorContext } from '../executor-context.js';
import { spawnFrontmcp, toAbsolute, waitForExit } from '../frontmcp-cli.js';
import type { ServeExecutorSchema } from './schema.js';

export default async function* serveExecutor(
  options: ServeExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean }> {
  const args: string[] = ['start'];
  if (context.projectName) args.push(context.projectName);
  if (options.entry) args.push('--entry', toAbsolute(context, options.entry));
  if (options.port !== undefined) args.push('--port', String(options.port));
  if (options.maxRestarts !== undefined) args.push('--max-restarts', String(options.maxRestarts));

  const child = spawnFrontmcp(context, args);
  if (!child) {
    yield { success: false };
    return;
  }

  yield { success: true };
  yield { success: (await waitForExit(child)) === 0 };
}
