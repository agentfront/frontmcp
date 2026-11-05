import { App } from '@frontmcp/sdk';

import DebugContextPrompt from './prompts/debug-context.prompt';
import { AppConfigProvider } from './providers/app-config.provider';
import { lifecycleProbeProvider } from './providers/lifecycle-probe.provider';
import { RequestLoggerProvider } from './providers/request-logger.provider';
import AppConfigResource from './resources/app-config.resource';
import GetAppInfoTool from './tools/get-app-info.tool';
import GetRequestInfoTool from './tools/get-request-info.tool';
import ReadGithubCredentialTool from './tools/read-github-credential.tool';

@App({
  name: 'config',
  providers: [AppConfigProvider, RequestLoggerProvider, lifecycleProbeProvider],
  tools: [GetAppInfoTool, GetRequestInfoTool, ReadGithubCredentialTool],
  resources: [AppConfigResource],
  prompts: [DebugContextPrompt],
})
export class ConfigApp {}
