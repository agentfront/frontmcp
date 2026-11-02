import { Plugin, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

/** Reads the tool name and the request from the hook's ctx, and tells every client the tool list changed. */
@Plugin({
  name: 'request-probe',
  description: 'Reports what a hook reads from its ctx about a probe-request call, and announces a tool list change',
})
export default class RequestProbePlugin {
  @ToolHook.Will('execute', { filter: (ctx) => ctx.toolName === 'probe-request' })
  probe(ctx: FlowCtxOf<'tools:call-tool'>) {
    const { sessionId, clientInfo } = ctx.request;
    ctx.state.set('resultMeta', {
      ...ctx.state.resultMeta,
      'request-probe': { toolName: ctx.toolName, sessionId, clientInfo },
    });
    ctx.notify.listChanged('tools');
  }
}
