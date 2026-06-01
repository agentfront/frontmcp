import { App } from '@frontmcp/sdk';

import ReadCredentialTool from '../notes/tools/read-credential.tool';

@App({
  name: 'Credentials',
  description: 'Per-session credential vault (Checkpoint 3b) E2E app',
  tools: [ReadCredentialTool],
})
export class CredentialsApp {}
