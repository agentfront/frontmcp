import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  name: 'admin-config',
  uri: 'config://admin-settings',
  description: 'Admin-only configuration resource',
  mimeType: 'application/json',
  authorities: 'admin',
})
export default class AdminConfigResource extends ResourceContext {
  async execute(): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    return {
      contents: [
        {
          uri: 'config://admin-settings',
          mimeType: 'application/json',
          text: JSON.stringify({ secret: 'admin-only-value', level: 'restricted' }),
        },
      ],
    };
  }
}
