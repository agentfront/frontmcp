import { App } from '@frontmcp/sdk';

import BoardColumnResource from './board-column.resource';
import BoardStatusResource from './board.resource';
import { BoardSummaryResource, PinNoteTool, RefreshSummaryTool, SummaryRunsTool } from './summary';

@App({
  name: 'board',
  description:
    'Materialized resources: a board and its columns other processes write, and a summary the server computes',
  resources: [BoardStatusResource, BoardColumnResource, BoardSummaryResource],
  tools: [PinNoteTool, RefreshSummaryTool, SummaryRunsTool],
})
export class BoardApp {}
