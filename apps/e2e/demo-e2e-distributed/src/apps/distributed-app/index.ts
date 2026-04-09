import { App } from '@frontmcp/sdk';

import { EchoTool } from './tools/echo.tool';
import { NodeInfoTool } from './tools/node-info.tool';

@App({
  name: 'distributed',
  tools: [EchoTool, NodeInfoTool],
})
export class DistributedApp {}
