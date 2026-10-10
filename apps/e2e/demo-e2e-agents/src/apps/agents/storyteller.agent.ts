import { z } from '@frontmcp/lazy-zod';
import {
  Agent,
  AgentContext,
  Tool,
  ToolContext,
  type AgentCompletion,
  type AgentCompletionChunk,
  type AgentLlmAdapter,
  type AgentPrompt,
} from '@frontmcp/sdk';

@Tool({ name: 'find_story', description: 'Find a story about a topic', inputSchema: { topic: z.string() } })
class FindStoryTool extends ToolContext {
  async execute(input: { topic: string }) {
    return { title: `The ${input.topic}` };
  }
}

/**
 * The model's two replies: it says what it does and calls `find_story` (its arguments arrive only
 * with the completion the stream ends with, as with the OpenAI and Anthropic adapters), then tells the
 * story it found.
 */
function turn(prompt: AgentPrompt): { chunks: AgentCompletionChunk[]; completion: AgentCompletion } {
  const found = prompt.messages.find((message) => message.role === 'tool');
  if (!found) {
    const topic = String(JSON.parse(prompt.messages[0]?.content ?? '{}').topic ?? 'Sea');
    return {
      chunks: [
        { type: 'content', content: 'Let me find ' },
        { type: 'content', content: 'a story. ' },
        { type: 'tool_call', toolCall: { id: 'story-1', name: 'find_story', arguments: {} } },
      ],
      completion: {
        content: 'Let me find a story. ',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'story-1', name: 'find_story', arguments: { topic } }],
      },
    };
  }
  const { title } = JSON.parse(found.content ?? '{}') as { title: string };
  const parts = [`${title}: `, 'once upon ', 'a time.'];
  return {
    chunks: parts.map((content) => ({ type: 'content' as const, content })),
    completion: { content: parts.join(''), finishReason: 'stop' },
  };
}

/** Mock LLM adapter that streams its replies chunk by chunk. */
const mockStorytellerAdapter: AgentLlmAdapter = {
  async completion(prompt) {
    return turn(prompt).completion;
  },
  async *streamCompletion(prompt) {
    const { chunks, completion } = turn(prompt);
    yield* chunks;
    yield { type: 'done', completion };
  },
};

/**
 * Storyteller Agent for testing streamed replies (#698): with `execution.enableStreaming`, a call that
 * carries a progress token gets the model's text as `notifications/progress`, one per chunk.
 */
@Agent({
  id: 'storyteller-agent',
  name: 'storyteller-agent',
  description: 'An agent that streams the story it tells',
  inputSchema: { topic: z.string().describe('What the story is about') },
  llm: { adapter: mockStorytellerAdapter },
  tools: [FindStoryTool],
  execution: { enableStreaming: true },
})
export class StorytellerAgent extends AgentContext {}
