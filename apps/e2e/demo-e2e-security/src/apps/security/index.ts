import { App } from '@frontmcp/sdk';

import AdminBriefingPrompt from './prompts/admin-briefing.prompt';
import PublicHelloPrompt from './prompts/public-hello.prompt';
import AdminConfigResource from './resources/admin-config.resource';
import PublicInfoResource from './resources/public-info.resource';
import AdminBackgroundJobTool from './tools/admin-background-job.tool';
import AdminMemoTool from './tools/admin-memo.tool';
import ElicitSecretTool from './tools/elicit-secret.tool';
import PublicNoteTool from './tools/public-note.tool';
import TenantReadTool from './tools/tenant-read.tool';

@App({
  name: 'security',
  description: 'Entry points exercised by the security e2e smoke tests.',
  tools: [PublicNoteTool, AdminMemoTool, TenantReadTool, AdminBackgroundJobTool, ElicitSecretTool],
  resources: [PublicInfoResource, AdminConfigResource],
  prompts: [PublicHelloPrompt, AdminBriefingPrompt],
})
export class SecurityApp {}
