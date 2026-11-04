import {
  addUsage,
  NO_USAGE,
  type EvalModel,
  type ModelReply,
  type ModelTool,
  type TokenUsage,
  type ToolResult,
} from './model';

export interface ToolOutcome {
  text: string;
  isError: boolean;
  structuredContent?: Record<string, unknown>;
}

export type CallTool = (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;

export interface ToolCallRecord extends ToolOutcome {
  name: string;
  input: Record<string, unknown>;
  durationMs: number;
}

export interface TaskTranscript {
  answer: string;
  /** Why the run ended: the last reply's stop reason, `turn_limit`, or `error` when the model call failed. */
  stopReason: string;
  /** How many requests were sent to the model. */
  turns: number;
  toolCalls: ToolCallRecord[];
  usage: TokenUsage;
  latencyMs: number;
  error?: string;
}

export interface RunTaskOptions {
  model: EvalModel;
  system: string;
  tools: ModelTool[];
  callTool: CallTool;
  prompt: string;
  maxTurns: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runToolCall(callTool: CallTool, name: string, input: Record<string, unknown>): Promise<ToolCallRecord> {
  const startedAt = Date.now();
  let outcome: ToolOutcome;
  try {
    outcome = await callTool(name, input);
  } catch (error) {
    outcome = { text: errorMessage(error), isError: true };
  }
  return { name, input, ...outcome, durationMs: Date.now() - startedAt };
}

/** Sends the prompt, runs each tool call the model makes over MCP, and returns once it answers or reaches `maxTurns`. */
export async function runTask({
  model,
  system,
  tools,
  callTool,
  prompt,
  maxTurns,
}: RunTaskOptions): Promise<TaskTranscript> {
  const startedAt = Date.now();
  const conversation = model.startConversation({ system, tools });
  const toolCalls: ToolCallRecord[] = [];
  let usage = NO_USAGE;
  let input: string | ToolResult[] = prompt;

  const finish = (ending: Pick<TaskTranscript, 'answer' | 'stopReason' | 'turns' | 'error'>): TaskTranscript => ({
    ...ending,
    toolCalls,
    usage,
    latencyMs: Date.now() - startedAt,
  });

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    let reply: ModelReply;
    try {
      reply = await conversation.send(input);
    } catch (error) {
      return finish({ answer: '', stopReason: 'error', turns: turn, error: errorMessage(error) });
    }
    usage = addUsage(usage, reply.usage);
    if (reply.toolCalls.length === 0) return finish({ answer: reply.text, stopReason: reply.stopReason, turns: turn });

    const results: ToolResult[] = [];
    for (const call of reply.toolCalls) {
      const record = await runToolCall(callTool, call.name, call.input);
      toolCalls.push(record);
      results.push({ callId: call.id, text: record.text, isError: record.isError });
    }
    input = results;
  }
  return finish({ answer: '', stopReason: 'turn_limit', turns: maxTurns });
}
