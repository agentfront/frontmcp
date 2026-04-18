import { Resource, ResourceContext } from '@frontmcp/sdk';

/**
 * No authorities — any authenticated caller may read. Baseline for asserting
 * that the resource pipeline isn't blanket-denying everything.
 */
@Resource({
  name: 'public-info',
  uri: 'info://public',
  description: 'Public info; no authorities.',
  mimeType: 'application/json',
})
export default class PublicInfoResource extends ResourceContext {
  async execute(): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    return {
      contents: [
        {
          uri: 'info://public',
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'ok', public: true }),
        },
      ],
    };
  }
}
