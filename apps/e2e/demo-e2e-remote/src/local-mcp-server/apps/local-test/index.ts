import { App } from '@frontmcp/sdk';

import GreetingPrompt from './prompts/greeting.prompt';
import ItemResource from './resources/item.resource';
import StatusResource from './resources/status.resource';
import AddTool from './tools/add.tool';
import ConnectionInfoTool from './tools/connection-info.tool';
import EchoTool from './tools/echo.tool';
import PingTool from './tools/ping.tool';
import SlowOperationTool from './tools/slow-operation.tool';

@App({
  name: 'LocalTest',
  description: 'Local test MCP server for E2E remote testing',
  tools: [EchoTool, PingTool, AddTool, SlowOperationTool, ConnectionInfoTool],
  resources: [StatusResource, ItemResource],
  prompts: [GreetingPrompt],
})
export class LocalTestApp {}
