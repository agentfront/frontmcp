import { App } from '@frontmcp/sdk';
import EchoTool from './tools/echo.tool';
import PingTool from './tools/ping.tool';
import AddTool from './tools/add.tool';
import SlowOperationTool from './tools/slow-operation.tool';
import StatusResource from './resources/status.resource';
import GreetingPrompt from './prompts/greeting.prompt';

@App({
  name: 'LocalTest',
  description: 'Local test MCP server for E2E remote testing',
  tools: [EchoTool, PingTool, AddTool, SlowOperationTool],
  resources: [StatusResource],
  prompts: [GreetingPrompt],
})
export class LocalTestApp {}
