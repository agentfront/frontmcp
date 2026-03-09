import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

type ItemParams = {
  itemId: string;
};

@ResourceTemplate({
  name: 'item-by-id',
  uriTemplate: 'items://item/{itemId}',
  description: 'Get an item by its ID',
  mimeType: 'application/json',
})
export default class ItemByIdTemplate extends ResourceContext<ItemParams> {
  async execute(uri: string, params: ItemParams): Promise<ReadResourceResult> {
    const { itemId } = params;
    const item = {
      id: itemId,
      name: `Item ${itemId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(item, null, 2),
        },
      ],
    };
  }
}
