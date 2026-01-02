import { App } from '@frontmcp/sdk';
import IsolatedHelloTool from './tools/isolated-hello.tool';
import IsolatedInfoResource from './resources/isolated-info.resource';

/**
 * Isolated Standalone App
 *
 * This app is configured with `standalone: true` which means:
 * - It gets its own isolated scope
 * - It's accessible at `/isolated/*` path
 * - SSE transport is at `/isolated/sse`
 * - Message endpoint is at `/isolated/message`
 */
@App({
  name: 'isolated',
  description: 'Standalone isolated app for testing scope isolation',
  tools: [IsolatedHelloTool],
  resources: [IsolatedInfoResource],
  auth: {
    mode: 'public',
  },
  standalone: true,
})
export class IsolatedApp {}
