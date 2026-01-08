import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';
import { DashboardApp } from '@frontmcp/plugins';

// Other demo apps available but not active:
import WeatherMcpApp from './apps/weather';
import ExpenseMcpApp from './apps/expenses';
import CalculatorMcpApp from './apps/calculator';
import EmployeeTimeMcpApp from './apps/employee-time';
import CrmMcpApp from './apps/crm';

@App({
  id: 'agent-link',
  name: 'Agent Link',
  adapters: [],
})
class AgentLinkApp {}

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  // apps: [DashboardApp, WeatherMcpApp, CrmMcpApp, ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp],
  apps: [AgentLinkApp],
  logging: { level: LogLevel.Verbose },
  http: {
    port: 3003,
  },
  transport: {
    enableLegacySSE: true,
  },
  auth: {
    mode: 'public',
  },
})
export default class Server {}
