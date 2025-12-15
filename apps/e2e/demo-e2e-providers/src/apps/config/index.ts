import { App } from '@frontmcp/sdk';
import { AppConfigProvider } from './providers/app-config.provider';
import { RequestLoggerProvider } from './providers/request-logger.provider';
import GetAppInfoTool from './tools/get-app-info.tool';
import GetRequestInfoTool from './tools/get-request-info.tool';
import AppConfigResource from './resources/app-config.resource';
import DebugContextPrompt from './prompts/debug-context.prompt';

@App({
  name: 'config',
  providers: [AppConfigProvider, RequestLoggerProvider],
  tools: [GetAppInfoTool, GetRequestInfoTool],
  resources: [AppConfigResource],
  prompts: [DebugContextPrompt],
})
export class ConfigApp {}
