import { App } from '@frontmcp/sdk';

import { AnthropicAgent } from './agents/anthropic.agent';
import { ErrorAgent } from './agents/error.agent';
import { MultiToolAgent } from './agents/multi-tool.agent';
import { NotifyingAgent } from './agents/notifying.agent';
import { OpenAIChatAgent } from './agents/openai-chat.agent';
import { OpenAIResponsesAgent } from './agents/openai-responses.agent';

@App({
  name: 'Agent Adapters',
  description: 'Agent adapter testing with real SDK types',
  agents: [OpenAIChatAgent, OpenAIResponsesAgent, AnthropicAgent, MultiToolAgent, NotifyingAgent, ErrorAgent],
})
export class AgentAdaptersApp {}
