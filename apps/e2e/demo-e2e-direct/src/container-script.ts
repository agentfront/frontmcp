/**
 * A script that reads a provider of the server with createContainer(), without serving MCP: it builds the
 * providers, prints what it read, disposes the container and exits on its own.
 */
import { createContainer } from '@frontmcp/sdk';

import { NotesArchive } from './apps/notes/providers/notes-archive.provider.js';
import { serverConfig } from './config.js';

async function main(): Promise<void> {
  const container = await createContainer(serverConfig);
  const archive = container.get(NotesArchive);
  const whileOpen = archive.state;
  await container.dispose();
  process.stdout.write(`${JSON.stringify({ whileOpen, afterDispose: archive.state })}\n`);
}

main().catch((error: unknown) => {
  console.error('container script failed:', error);
  process.exit(1);
});
