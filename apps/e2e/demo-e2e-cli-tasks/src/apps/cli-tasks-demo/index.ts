import { App } from '@frontmcp/sdk';

import CancellableWaitTool from './tools/cancellable-wait.tool';
import CrashTool from './tools/crash.tool';
import SlowEchoTool from './tools/slow-echo.tool';

@App({
  name: 'CLI Tasks Demo',
  description: 'Exercises the CLI task runner: spawn detached, SQLite store, SIGTERM cancel, orphan detection.',
  tools: [SlowEchoTool, CancellableWaitTool, CrashTool],
})
export class CliTasksDemoApp {}
