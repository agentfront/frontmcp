import { App } from '@frontmcp/sdk';
import SessionInfoTool from './tools/session-info.tool';
import UpdateSessionStateTool from './tools/update-session-state.tool';
import CheckSessionTool from './tools/check-session.tool';
import SessionIsolationTool from './tools/session-isolation.tool';

@App({
  name: 'Transport',
  description: 'Transport Session testing app for E2E tests',
  tools: [SessionInfoTool, UpdateSessionStateTool, CheckSessionTool, SessionIsolationTool],
})
export class TransportApp {}
