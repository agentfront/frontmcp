import { Agent, AgentContext } from '@frontmcp/sdk';
import GetWeatherTool from '../tools/get-weather.tool';
import { z } from 'zod';

@Agent({
  name: 'summary-agent',
  description: 'Agent that provides weather summaries',
  inputSchema: {
    location: z.string().describe('City name or location'),
    units: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature units'),
  },
  llm: {
    provider: 'openai',
    model: 'gpt-5',
    apiKey: {
      env: 'OPENAI_API_KEY',
    },
  },
  tools: [GetWeatherTool],
})
export default class SummaryAgent extends AgentContext {}
