/**
 * Weather Demo App with MDX UI
 *
 * Demonstrates Tool UI templates using MDX (Markdown + JSX).
 * MDX allows mixing markdown content with React components.
 */

import { App } from '@frontmcp/sdk';

import GetWeatherTool from './tools/get-weather.tool';

@App({
  id: 'weather-mdx',
  name: 'Weather MCP App (MDX UI)',
  description: 'Demo app showing MDX Tool UI templates for rich weather displays',
  providers: [],
  tools: [GetWeatherTool],
})
export default class WeatherMcpApp {}
