import { App } from '@frontmcp/sdk';

import DeploymentCheckPrompt from './prompts/deployment-check.prompt';
import ServerlessEnvResource from './resources/serverless-env.resource';
import ColdStartTestTool from './tools/cold-start-test.tool';
import ServerlessInfoTool from './tools/serverless-info.tool';

@App({
  name: 'serverless',
  description: 'Serverless deployment demo',
  tools: [ServerlessInfoTool, ColdStartTestTool],
  resources: [ServerlessEnvResource],
  prompts: [DeploymentCheckPrompt],
})
export class ServerlessApp {}
