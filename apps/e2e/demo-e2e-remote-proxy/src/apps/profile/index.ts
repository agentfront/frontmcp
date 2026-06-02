/**
 * Profile App — demonstrates remote-proxy upstream token access.
 */
import { App } from '@frontmcp/sdk';

import { WhoamiTool } from './tools/whoami.tool';

@App({
  id: 'profile',
  name: 'Profile',
  description: 'Reads the upstream IdP token via orchestration in remote-proxy mode',
  tools: [WhoamiTool],
})
export class ProfileApp {}
