import type { ExecutorContext } from '../executor-context.js';
import { spawnFrontmcp, toAbsolute, waitForExit } from '../frontmcp-cli.js';
import type { DevExecutorSchema } from './schema.js';

export default async function* devExecutor(
  options: DevExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean; baseUrl?: string }> {
  const args: string[] = ['dev'];
  if (options.entry) args.push('--entry', toAbsolute(context, options.entry));
  if (options.port !== undefined) args.push('--port', String(options.port));

  const child = spawnFrontmcp(context, args);
  if (!child) {
    yield { success: false };
    return;
  }

  yield { success: true, ...(options.port !== undefined && { baseUrl: `http://localhost:${options.port}` }) };
  yield { success: (await waitForExit(child)) === 0 };
}
