import { MaterializedResourceContext, ResourceTemplate } from '@frontmcp/sdk';

import { columns } from './board.store';

@ResourceTemplate({
  name: 'board-column',
  uriTemplate: 'board://columns/{column}',
  description: 'The cards of one column, which other processes write to the shared store',
  mimeType: 'application/json',
  from: columns,
})
export default class BoardColumnResource extends MaterializedResourceContext {}
