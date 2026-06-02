import { App } from '@frontmcp/sdk';

import SecretTool from './tools/secret-tool';

@App({
  name: 'SecureStore',
  description: 'General session secure-secret store (#470) E2E app',
  tools: [SecretTool],
})
export class SecureStoreApp {}
