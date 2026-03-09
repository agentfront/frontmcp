import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

@Resource({
  name: 'app-info',
  uri: 'app://info',
  description: 'Application information',
  mimeType: 'application/json',
})
export default class AppInfoResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const info = {
      name: 'CLI Exec E2E Demo',
      version: '1.0.0',
      description: 'E2E test fixture for CLI exec build pipeline',
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }
}
