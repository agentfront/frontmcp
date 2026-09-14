import { App } from '@frontmcp/sdk';

import ReadSecretTool from './tools/read-secret.tool';

@App({
  name: 'lab',
  description: 'Lab app whose inventory the dashboard would expose',
  tools: [ReadSecretTool],
})
export class LabApp {}
