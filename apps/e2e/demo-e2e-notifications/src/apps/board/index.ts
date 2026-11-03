import { App } from '@frontmcp/sdk';

import BoardStatusResource from './board.resource';

@App({
  name: 'board',
  description: 'A materialized resource that other processes update through a shared SQLite store',
  resources: [BoardStatusResource],
})
export class BoardApp {}
