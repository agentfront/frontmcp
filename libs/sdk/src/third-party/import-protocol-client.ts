// The `import` variant of `#protocol-client`: an ESM build loads the MCP client the first time it connects.
import type { ProtocolClientModule } from './protocol-client';

export const loadProtocolClient = (): Promise<ProtocolClientModule> => import('@frontmcp/protocol/client');
