/**
 * Weather Demo App with React UI
 *
 * Demonstrates Tool UI templates using React components.
 * Shows how to render interactive React widgets in MCP hosts.
 */

import { App } from '@frontmcp/sdk';

import GetWeatherTool from './tools/get-weather.tool';

@App({
  id: 'weather-react',
  name: 'Weather MCP App (React UI)',
  description: 'Demo app showing React Tool UI templates for rich weather displays',
  providers: [],
  tools: [GetWeatherTool],
})
export default class WeatherMcpApp {}
