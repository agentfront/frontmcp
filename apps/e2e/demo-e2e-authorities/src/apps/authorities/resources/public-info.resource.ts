import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  name: 'public-info',
  uri: 'info://public',
  description: 'Public information resource — no authorities',
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
