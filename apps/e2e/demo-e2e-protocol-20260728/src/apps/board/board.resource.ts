import { MaterializedResourceContext, Resource } from '@frontmcp/sdk';

import { board } from './board.store';

@Resource({
  name: 'board-status',
  uri: 'board://status',
  description: 'The board other processes write, served from the shared store',
  mimeType: 'application/json',
  from: board,
})
export default class BoardStatusResource extends MaterializedResourceContext {}
