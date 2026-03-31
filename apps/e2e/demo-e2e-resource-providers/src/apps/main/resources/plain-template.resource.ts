import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';

/**
 * Resource template with NO completer.
 * Used to test that completion returns empty results for resources without completers.
 */
@ResourceTemplate({
  name: 'plain-template',
  uriTemplate: 'plain://{itemId}/info',
  description: 'A plain template resource without completers',
  mimeType: 'application/json',
})
export default class PlainTemplateResource extends ResourceContext<{ itemId: string }> {
  async execute(uri: string, params: { itemId: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ itemId: params.itemId }),
        },
      ],
    };
  }
}
