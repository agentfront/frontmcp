import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { AppConfigProvider } from '../providers/app-config.provider';
import { REQUEST_LOGGER_TOKEN, RequestLogger } from '../providers/request-logger.provider';

// Singleton instances
let appConfigProviderInstance: AppConfigProvider | null = null;

@Prompt({
  name: 'debug-context',
  description: 'Debug provider context and injection',
  arguments: [],
})
export default class DebugContextPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    // Get GLOBAL provider - use singleton pattern
    if (!appConfigProviderInstance) {
      appConfigProviderInstance = new AppConfigProvider();
    }
    const config = appConfigProviderInstance;
    const appInfo = config.getInfo();

    // Get CONTEXT provider
    const logger = this.get<RequestLogger>(REQUEST_LOGGER_TOKEN);
    const requestInfo = logger.getInfo();

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please analyze the following provider context debug info:

## GLOBAL Scope Provider (AppConfigProvider)
- App Name: ${appInfo.appName}
- Version: ${appInfo.version}
- Environment: ${appInfo.environment}
- Started At: ${appInfo.startedAt.toISOString()}
- Instance ID: ${appInfo.instanceId}

## CONTEXT Scope Provider (RequestLoggerProvider)
- Request ID: ${requestInfo.requestId}
- Session ID: ${requestInfo.sessionId}
- Created At: ${requestInfo.createdAt}
- Instance ID: ${requestInfo.instanceId}
- Logs: ${requestInfo.logs.length} entries

The GLOBAL provider should have the same instance ID across all requests.
The CONTEXT provider should have a different instance ID for each request.`,
          },
        },
      ],
      description: 'Provider context debug information',
    };
  }
}
