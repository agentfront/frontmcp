import { App } from '@frontmcp/sdk';
import ParentHelloTool from './tools/parent-hello.tool';

/**
 * Parent App (non-standalone)
 *
 * This app is NOT standalone, so it lives in the root scope.
 * Its tools should be accessible via the root SSE endpoint (/).
 */
@App({
  name: 'parent',
  description: 'Parent app in the root scope',
  tools: [ParentHelloTool],
})
export class ParentApp {}
