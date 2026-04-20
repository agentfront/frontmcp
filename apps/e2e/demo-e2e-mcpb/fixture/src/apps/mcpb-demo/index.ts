import { App } from '@frontmcp/sdk';

import EchoTool from './tools/echo.tool';
import GreetTool from './tools/greet.tool';

@App({
  name: 'McpbDemo',
  description: 'Minimal fixture exercising the MCPB build target',
  tools: [GreetTool, EchoTool],
})
export class McpbDemoApp {}
