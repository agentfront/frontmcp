import { App } from '@frontmcp/sdk';

import ProcessInfoTool from './tools/process-info.tool';
import WhoAmITool from './tools/whoami.tool';

@App({
  name: 'Probe',
  description: 'Reports what the server process sees, for @frontmcp/testing E2E tests',
  tools: [ProcessInfoTool, WhoAmITool],
})
export class ProbeApp {}
