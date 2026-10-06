import { App } from '@frontmcp/sdk';

import ConfirmActionTool from './tools/confirm-action.tool';
import ConnectAccountTool from './tools/connect-account.tool';
import GetUserInputTool from './tools/get-user-input.tool';
import MultiStepWizardTool from './tools/multi-step.tool';

@App({
  name: 'Elicitation Demo',
  description: 'Demo application for testing MCP elicitation feature',
  tools: [ConfirmActionTool, GetUserInputTool, MultiStepWizardTool, ConnectAccountTool],
})
export class ElicitationDemoApp {}
