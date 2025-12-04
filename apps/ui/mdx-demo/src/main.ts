/**
 * MDX Demo - Tool UI with MDX Templates
 *
 * This demo shows how to use MDX (Markdown + JSX) for Tool UI templates.
 * The MDX renderer compiles markdown with JSX components at runtime
 * and uses react-dom/server for server-side rendering to HTML.
 */

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import WeatherMcpApp from './apps/weather';

@FrontMcp({
  info: { name: 'MDX UI Demo', version: '0.1.0' },
  apps: [WeatherMcpApp],
  logging: { level: LogLevel.Debug },
  http: {
    port: 3004,
  },
  auth: {
    mode: 'public',
  },
})
export default class Server {}
