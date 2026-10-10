import { App } from '@frontmcp/sdk';

import { CalculatorAgent } from './calculator.agent';
import { EchoAgent } from './echo.agent';
import { LibrarianAgent } from './librarian.agent';
import { OrchestratorAgent } from './orchestrator.agent';
import { StorytellerAgent } from './storyteller.agent';

@App({
  name: 'Agents',
  description: 'Agent testing application for E2E testing',
  agents: [EchoAgent, CalculatorAgent, OrchestratorAgent, LibrarianAgent, StorytellerAgent],
})
export class AgentsApp {}
