import { App } from '@frontmcp/sdk';

import ReadCredentialTool from '../notes/tools/read-credential.tool';
import { GatedAcmeTool, GatedGlobexTool, GatedOptionalTool } from './tools/gated-tools';

@App({
  name: 'Credentials',
  description: 'Per-session credential vault (Checkpoint 3b) E2E app',
  tools: [ReadCredentialTool, GatedAcmeTool, GatedGlobexTool, GatedOptionalTool],
})
export class CredentialsApp {}
