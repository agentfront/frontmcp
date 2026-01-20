import { FrontMcp, LogLevel } from '@frontmcp/sdk';

// Other demo apps available but not active:
import WeatherMcpApp from './apps/weather';
import ExpenseMcpApp from './apps/expenses';
import CalculatorMcpApp from './apps/calculator';
import EmployeeTimeMcpApp from './apps/employee-time';
import CrmMcpApp from './apps/crm';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [WeatherMcpApp, CrmMcpApp, ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp],
  logging: { level: LogLevel.Verbose },
  http: {
    port: 3003,
  },
  transport: {
    protocol: 'legacy',
  },
  redis: {
    port: 6379,
    host: 'localhost',
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
