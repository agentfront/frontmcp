/**
 * React Demo - Tool UI with React Components
 *
 * This demo shows how to use React components for Tool UI templates.
 * The React renderer transpiles JSX at runtime and uses react-dom/server
 * for server-side rendering to HTML.
 */

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import WeatherMcpApp from './apps/weather';

@FrontMcp({
  info: { name: 'React UI Demo', version: '0.1.0' },
  apps: [WeatherMcpApp],
  logging: { level: LogLevel.Debug },
  http: {
    port: 3003,
  },
  auth: {
    mode: 'transparent',
    remote: {
      provider: 'https://sample-app.frontegg.com',
      name: 'frontegg',
      dcrEnabled: false,
    },
  },
})
export default class Server {}
