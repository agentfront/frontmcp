import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { auditLog } from '../data/audit-log';

const argsSchema = [];

@Prompt({
  name: 'audit-summary',
  description: 'Generate a summary of the audit log',
  arguments: argsSchema,
})
export default class AuditSummaryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const entries = auditLog.getEntries();
    const stats = auditLog.getStats();
    const executionOrder = auditLog.getExecutionOrder();

    const toolsInvoked = [...new Set(entries.map((e) => e.toolName))];

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `# Audit Log Summary

## Statistics
- Total entries: ${stats.total}
- Will hooks executed: ${stats.willCount}
- Did hooks executed: ${stats.didCount}

## Tools Invoked
${toolsInvoked.length > 0 ? toolsInvoked.map((t) => `- ${t}`).join('\n') : 'No tools invoked yet'}

## Hook Execution Order
The following shows the order hooks were executed (hookType:stage:priority):
${executionOrder.length > 0 ? executionOrder.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'No hooks executed yet'}

## Expected Pattern
For each tool call, you should see:
1. will:execute:100 (high priority will hook)
2. will:execute:50 (low priority will hook)
3. [tool execution]
4. did:execute:100 (high priority did hook)
5. did:execute:50 (low priority did hook)`,
          },
        },
      ],
      description: 'Audit log summary with hook execution analysis',
    };
  }
}
