import { App } from '@frontmcp/sdk';

import ServerlessInfoTool from './tools/serverless-info.tool';
import ColdStartTestTool from './tools/cold-start-test.tool';

import ServerlessEnvResource from './resources/serverless-env.resource';

import DeploymentCheckPrompt from './prompts/deployment-check.prompt';

@App({
  name: 'serverless',
  description: 'Serverless deployment demo',
  tools: [ServerlessInfoTool, ColdStartTestTool],
  resources: [ServerlessEnvResource],
  prompts: [DeploymentCheckPrompt],
})
export class ServerlessApp {}
