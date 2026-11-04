import { NO_USAGE, type EvalModel, type ModelReply, type ToolCall } from './model';

/** A fixed sequence of turns, each a list of tool calls, and the answer that follows them. */
export interface Script {
  turns: Array<Array<Omit<ToolCall, 'id'>>>;
  answer: string;
}

/** A model that plays each prompt's script, so the harness runs end to end with no API key and no network. */
export function scriptedModel(tasks: ReadonlyArray<{ prompt: string; dryRun: Script }>): EvalModel {
  const scripts = new Map(tasks.map((task) => [task.prompt, task.dryRun]));
  return {
    id: 'scripted',
    startConversation() {
      let script: Script | undefined;
      let turn = 0;
      return {
        async send(input): Promise<ModelReply> {
          if (typeof input === 'string') script = scripts.get(input);
          if (!script) throw new Error('the scripted model has no script for this conversation');
          const calls = script.turns[turn] ?? [];
          turn += 1;
          return {
            text: calls.length === 0 ? script.answer : '',
            toolCalls: calls.map((call, index) => ({ id: `call_${turn}_${index}`, ...call })),
            stopReason: calls.length === 0 ? 'end_turn' : 'tool_use',
            usage: NO_USAGE,
          };
        },
      };
    },
  };
}
