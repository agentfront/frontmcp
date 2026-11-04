import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

@FrontMcp({ ...serverConfig, http: { port } } as unknown as FrontMcpInput)
export default class Server {}
