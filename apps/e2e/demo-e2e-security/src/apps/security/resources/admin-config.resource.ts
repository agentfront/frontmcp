import { Resource, ResourceContext } from '@frontmcp/sdk';

/**
 * Admin-only via RBAC profile. Enforced at the `checkEntryAuthorities` flow
 * stage in `resources/read` and filtered out of `resources/list` for callers
 * that don't satisfy the `admin` profile.
 */
@Resource({
  name: 'admin-config',
  uri: 'config://admin-settings',
  description: 'Admin-only configuration.',
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
