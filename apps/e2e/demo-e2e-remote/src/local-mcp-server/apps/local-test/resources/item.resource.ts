import { ResourceContext, ResourceTemplate, type ReadResourceResult } from '@frontmcp/sdk';

@ResourceTemplate({
  name: 'item',
  uriTemplate: 'test://items/{id}',
  description: 'An item by id',
  mimeType: 'application/json',
})
export default class ItemResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }): Promise<ReadResourceResult> {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ id: params.id }) }] };
  }
}
