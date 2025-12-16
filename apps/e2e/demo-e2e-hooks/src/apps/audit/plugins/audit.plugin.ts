import { Plugin, ToolHook, FlowCtxOf } from '@frontmcp/sdk';
import { auditLog } from '../data/audit-log';
import { randomUUID } from 'crypto';

/**
 * Audit Plugin that demonstrates Will/Did hook patterns.
 *
 * Will hooks run BEFORE tool execution (higher priority = runs first)
 * Did hooks run AFTER tool execution (higher priority = runs first)
 */
@Plugin({
  name: 'audit',
  description: 'Audit plugin for tracking tool execution lifecycle',
})
export default class AuditPlugin {
  private startTimes: Map<string, number> = new Map();

  /**
   * Will hook with HIGH priority (100) - runs first
   * Used for early audit logging before execution
   */
  @ToolHook.Will('execute', { priority: 100 })
  async willExecuteHighPriority(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    const requestId = randomUUID();
    this.startTimes.set(requestId, Date.now());
    flowCtx.state['auditRequestId'] = requestId;

    auditLog.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: tool.metadata.name,
      hookType: 'will',
      stage: 'execute',
      priority: 100,
      input: toolContext.input,
    });
  }

  /**
   * Will hook with LOW priority (50) - runs after high priority
   * Used for validation or additional pre-processing
   */
  @ToolHook.Will('execute', { priority: 50 })
  async willExecuteLowPriority(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (!tool) return;

    auditLog.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: tool.metadata.name,
      hookType: 'will',
      stage: 'execute',
      priority: 50,
    });
  }

  /**
   * Did hook with HIGH priority (100) - runs first after execution
   * Used for immediate post-execution logging
   */
  @ToolHook.Did('execute', { priority: 100 })
  async didExecuteHighPriority(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    const requestId = flowCtx.state['auditRequestId'] as string;
    const startTime = this.startTimes.get(requestId);
    const durationMs = startTime ? Date.now() - startTime : undefined;

    if (requestId) {
      this.startTimes.delete(requestId);
    }

    auditLog.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: tool.metadata.name,
      hookType: 'did',
      stage: 'execute',
      priority: 100,
      output: toolContext.output,
      durationMs,
      success: true,
    });
  }

  /**
   * Did hook with LOW priority (50) - runs after high priority
   * Used for cleanup or final logging
   */
  @ToolHook.Did('execute', { priority: 50 })
  async didExecuteLowPriority(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (!tool) return;

    auditLog.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: tool.metadata.name,
      hookType: 'did',
      stage: 'execute',
      priority: 50,
    });
  }
}
