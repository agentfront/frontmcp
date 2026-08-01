import { App } from '@frontmcp/sdk';

import GreetingPrompt from './prompts/greeting.prompt';
import ConfigResource from './resources/config.resource';
import ChattyTool from './tools/chatty.tool';
import ConfirmTool from './tools/confirm.tool';
import EchoTool from './tools/echo.tool';
import ListWorkspacesTool from './tools/list-workspaces.tool';
import RegionQueryTool from './tools/region-query.tool';
import SummarizeTool from './tools/summarize.tool';

/**
 * Fixture app for the 2026-07-28 protocol conformance suite.
 *
 * Deliberately covers every surface the revision changed: tools (incl. the
 * `x-mcp-header` extension and an elicitation-driven MRTR tool), a resource,
 * and a prompt — so `tools/list`, `resources/list`, `resources/read`,
 * `prompts/list`, and `prompts/get` all have something to return.
 */
@App({
  name: 'proto',
  description: 'Protocol 2026-07-28 conformance fixture',
  tools: [EchoTool, RegionQueryTool, ConfirmTool, SummarizeTool, ListWorkspacesTool, ChattyTool],
  resources: [ConfigResource],
  prompts: [GreetingPrompt],
})
export class ProtoApp {}
