/**
 * Stdio entry that passes the @FrontMcp-decorated CLASS to runStdio (#450).
 *
 * The SDK JSDoc historically showed `FrontMcpInstance.runStdio(MyServer)` with
 * the decorated class, which used to throw a Zod error ("apps expected array").
 * This entry proves runStdio now accepts a class by resolving its stored
 * `@FrontMcp` metadata.
 *
 * FRONTMCP_SCHEMA_EXTRACT=1 suppresses the decorator's import-time auto-bootstrap
 * while we load the class (exactly what the generated CLI/`--stdio` entries do),
 * so the only server started is the explicit runStdio(class) call below.
 */
import 'reflect-metadata';

import { FrontMcpInstance } from '@frontmcp/sdk';

async function main(): Promise<void> {
  process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
  const mod = await import('./main.js');
  delete process.env['FRONTMCP_SCHEMA_EXTRACT'];

  const ServerClass = (mod as Record<string, unknown>)['StdioTransportE2EServer'];
  // Pass the decorated CLASS (not a config object) — runStdio resolves its
  // @FrontMcp metadata and serves over stdio with no TCP port bound.
  await FrontMcpInstance.runStdio(ServerClass as never);
}

main().catch((err) => {
  console.error('Failed to start stdio (class) server:', err);
  process.exit(1);
});
