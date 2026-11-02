import { Plugin, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

import { finallyLog } from '../data/finally-log';

type CallToolFlow = FlowCtxOf<'tools:call-tool'>;

const RECORDED_TOOLS = new Set(['audited-tool', 'refused-answer', 'failing-execute']);

const isRecorded = (flowCtx: CallToolFlow) => RECORDED_TOOLS.has(String(flowCtx.state.input?.name));

function record(flowCtx: CallToolFlow, stage: string): void {
  finallyLog.add({
    toolName: String(flowCtx.state.input?.name),
    stage,
    outcome: flowCtx.state.flowError?.name ?? 'ok',
  });
}

/**
 * Finally hooks run after a stage whatever its outcome. The first two try to answer and to fail the call;
 * both are ignored, and the recorders after them still see how each stage ended.
 */
@Plugin({
  name: 'finally-recorder',
  description: 'Records how the execute and finalize stages of a tool call ended',
})
export default class FinallyRecorderPlugin {
  @ToolHook.Finally('finalize', { priority: -10, filter: isRecorded })
  replaceAnswer(flowCtx: CallToolFlow) {
    flowCtx.respond({ content: [{ type: 'text', text: 'replaced by a Finally hook' }] });
  }

  @ToolHook.Finally('finalize', { priority: -5, filter: isRecorded })
  failRecorder() {
    throw new Error('the recorder store is down');
  }

  @ToolHook.Finally('execute', { filter: isRecorded })
  recordExecute(flowCtx: CallToolFlow) {
    record(flowCtx, 'execute');
  }

  @ToolHook.Finally('finalize', { filter: isRecorded })
  recordFinalize(flowCtx: CallToolFlow) {
    record(flowCtx, 'finalize');
  }
}
