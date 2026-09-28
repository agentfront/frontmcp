import { type CallSurface } from '../../common/availability';

/**
 * The surface an MCP request arrives on, for `availableWhen.surface`.
 *
 * `'cli'` for the in-process client of a CLI build: its scope is created by
 * `FrontMcpInstance.createForCli`, which only the generated CLI (and its schema extractor) uses.
 * `'mcp'` for every other MCP client: a transport (HTTP, SSE, stdio, a CLI daemon's socket), the
 * 2026-07-28 dispatcher, or `connect()`.
 */
export function mcpRequestSurface(scope: { readonly metadata: object } | undefined): CallSurface {
  return (scope?.metadata as Record<string, unknown> | undefined)?.['__cliMode'] === true ? 'cli' : 'mcp';
}

/**
 * The request context an MCP handler passes to its flow, tagged with the surface the request
 * arrived on, so the flow applies `availableWhen.surface` to what the request names or lists.
 */
export function withMcpSurface<Ctx extends object>(
  scope: { readonly metadata: object } | undefined,
  ctx: Ctx,
): Ctx & { surface: CallSurface } {
  return { ...ctx, surface: mcpRequestSurface(scope) };
}
