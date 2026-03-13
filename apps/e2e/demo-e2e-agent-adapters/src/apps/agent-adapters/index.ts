import { App } from '@frontmcp/sdk';
import { OpenAIChatAgent } from './agents/openai-chat.agent';
import { OpenAIResponsesAgent } from './agents/openai-responses.agent';
import { AnthropicAgent } from './agents/anthropic.agent';
import { MultiToolAgent } from './agents/multi-tool.agent';
import { NotifyingAgent } from './agents/notifying.agent';
import { ErrorAgent } from './agents/error.agent';

@App({
  name: 'Agent Adapters',
  description: 'Agent adapter testing with real SDK types',
  agents: [OpenAIChatAgent, OpenAIResponsesAgent, AnthropicAgent, MultiToolAgent, NotifyingAgent, ErrorAgent],
})
export class AgentAdaptersApp {}
