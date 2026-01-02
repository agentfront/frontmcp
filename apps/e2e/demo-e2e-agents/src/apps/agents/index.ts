import { App } from '@frontmcp/sdk';
import { EchoAgent } from './echo.agent';
import { CalculatorAgent } from './calculator.agent';
import { OrchestratorAgent } from './orchestrator.agent';

@App({
  name: 'Agents',
  description: 'Agent testing application for E2E testing',
  agents: [EchoAgent, CalculatorAgent, OrchestratorAgent],
})
export class AgentsApp {}
