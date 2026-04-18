import { App } from '@frontmcp/sdk';

import BigReportTool from './tools/big-report.tool';
import CancellableWaitTool from './tools/cancellable-wait.tool';
import FlakyTool from './tools/flaky.tool';
import InstantEchoTool from './tools/instant-echo.tool';
import SlowWeatherTool from './tools/slow-weather.tool';

@App({
  name: 'Tasks Demo',
  description: 'Demo application exercising MCP 2025-11-25 background tasks.',
  tools: [SlowWeatherTool, BigReportTool, InstantEchoTool, FlakyTool, CancellableWaitTool],
})
export class TasksDemoApp {}
