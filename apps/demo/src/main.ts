import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { DashboardApp } from '@frontmcp/plugins';

// Other demo apps available but not active:
import WeatherMcpApp from './apps/weather';
import ExpenseMcpApp from './apps/expenses';
import CalculatorMcpApp from './apps/calculator';
import EmployeeTimeMcpApp from './apps/employee-time';
import CrmMcpApp from './apps/crm';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [DashboardApp, WeatherMcpApp, CrmMcpApp, ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp],
  logging: { level: LogLevel.Verbose },
  http: {
    port: 3002,
  },
  transport: {
    enableLegacySSE: true,
  },
  auth: {
    mode: 'transparent',
    remote: {
      provider: process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com',
      name: 'frontegg',
      dcrEnabled: false,
    },
    expectedAudience: process.env['IDP_EXPECTED_AUDIENCE'] || 'https://sample-app.frontegg.com',
    requiredScopes: [],
    allowAnonymous: true, // Allow anonymous access for demo
    anonymousScopes: ['anonymous'],
  },
})
export default class Server {}
