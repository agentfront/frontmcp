/**
 * Weather Demo App
 *
 * Demonstrates Tool UI templates with the @Tool decorator.
 * Shows how to render rich HTML widgets in OpenAI Apps SDK and ext-apps.
 */

import { App } from '@frontmcp/sdk';

import GetWeatherTool from './tools/get-weather.tool';
import SummaryAgent from './agents/summary.agent';

@App({
  id: 'weather',
  name: 'Weather MCP App',
  description: 'Demo app showing Tool UI templates for rich weather displays',
  providers: [],
  // agents: [SummaryAgent],
  tools: [GetWeatherTool],
})
export default class WeatherMcpApp {}
