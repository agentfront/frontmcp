import { App } from '@frontmcp/sdk';

import SessionSummaryPrompt from './prompts/session-summary.prompt';
import SessionCurrentResource from './resources/session-current.resource';
import GetSessionDataTool from './tools/get-session-data.tool';
import SetSessionDataTool from './tools/set-session-data.tool';

@App({
  name: 'Sessions',
  description: 'Session management application for E2E testing with mocked Redis',
  tools: [SetSessionDataTool, GetSessionDataTool],
  resources: [SessionCurrentResource],
  prompts: [SessionSummaryPrompt],
})
export class SessionsApp {}
