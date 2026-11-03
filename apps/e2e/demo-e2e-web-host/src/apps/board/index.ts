import { App } from '@frontmcp/sdk';

import { AddCardRoute, BoardEvents, BoardPage, StatusRoute } from './board.routes';
import { AddCardTool, RecordVisitTool } from './board.tools';
import { VisitCounter } from './visit-counter.provider';

@App({
  name: 'board',
  description: 'A board that agents change through tools and people see through pages',
  providers: [VisitCounter],
  tools: [AddCardTool, RecordVisitTool],
  routes: [BoardPage, AddCardRoute, BoardEvents, StatusRoute],
})
export class BoardApp {}
