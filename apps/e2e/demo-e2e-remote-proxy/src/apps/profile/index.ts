/**
 * Profile App — demonstrates remote-proxy upstream token access.
 */
import { App } from '@frontmcp/sdk';

import { FlowAccessPlugin } from '../flow-access/flow-access.plugin';
import { WhoamiTool } from './tools/whoami.tool';

@App({
  id: 'profile',
  name: 'Profile',
  description: 'Reads the upstream IdP token via orchestration in remote-proxy mode',
  tools: [WhoamiTool],
  plugins: [FlowAccessPlugin],
})
export class ProfileApp {}
