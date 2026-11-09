import { App } from '@frontmcp/sdk';

import CheckSessionTool from './tools/check-session.tool';
import SessionInfoTool from './tools/session-info.tool';
import SessionIsolationTool from './tools/session-isolation.tool';
import UpdateSessionStateTool from './tools/update-session-state.tool';

@App({
  name: 'Transport',
  description: 'Transport Session testing app for E2E tests',
  tools: [SessionInfoTool, UpdateSessionStateTool, CheckSessionTool, SessionIsolationTool],
})
export class TransportApp {}
