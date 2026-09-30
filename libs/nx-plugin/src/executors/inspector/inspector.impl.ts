import type { ExecutorContext } from '../executor-context.js';
import { spawnFrontmcp, stopChild, waitForExit } from '../frontmcp-cli.js';
import type { InspectorExecutorSchema } from './schema.js';

export default async function* inspectorExecutor(
  options: InspectorExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean }> {
  // `frontmcp inspector` takes no flags; the MCP Inspector it launches reads its UI port from the environment.
  const child = spawnFrontmcp(
    context,
    ['inspector'],
    options.port !== undefined ? { CLIENT_PORT: String(options.port) } : {},
  );
  if (!child) {
    yield { success: false };
    return;
  }

  try {
    yield { success: true };
    yield { success: (await waitForExit(child)) === 0 };
  } finally {
    stopChild(child);
  }
}
