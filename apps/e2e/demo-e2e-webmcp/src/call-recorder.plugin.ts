import { Plugin, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

declare global {
  interface Window {
    /** Every tool the `tools:call-tool` flow ran, as a plugin hook saw it. */
    __hookCalls?: string[];
  }
}

/** Records every tool call in `window.__hookCalls`, to show agent calls run through the flow. */
@Plugin({ name: 'call-recorder' })
export class CallRecorderPlugin {
  @ToolHook.Will('execute')
  record(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (!tool) return;
    window.__hookCalls ??= [];
    window.__hookCalls.push(tool.metadata.name);
  }
}
