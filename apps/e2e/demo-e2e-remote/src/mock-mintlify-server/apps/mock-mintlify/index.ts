import { App } from '@frontmcp/sdk';
import SearchMintlifyTool from './tools/search-mintlify.tool';

@App({
  name: 'MockMintlify',
  description: 'Mock Mintlify MCP server for E2E testing',
  tools: [SearchMintlifyTool],
})
export class MockMintlifyApp {}
