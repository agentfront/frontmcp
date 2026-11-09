/**
 * @file full-package.ts
 * @description A package fixture with every kind of entry an ESM app loads: a provider, a tool, a skill, an agent,
 * a job and a workflow. Transpiled with esbuild (deps externalized) and served by the ESM package server as
 * `@test/esm-full`; `PACKAGE_VERSION` is set at build time, so each published version answers with its own.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, Job, JobContext, Provider, Skill, Tool, ToolContext, Workflow } from '@frontmcp/sdk';

declare const PACKAGE_VERSION: string;

const SKILL_NAME = PACKAGE_VERSION === '1.0.0' ? 'welcome' : 'farewell';

@Provider({ name: 'GreetingService' })
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}, from ${PACKAGE_VERSION}`;
  }
}

@Tool({
  name: 'greet',
  description: 'Greets someone through the package provider',
  inputSchema: { name: z.string() },
})
export class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return this.get(GreetingService).greet(name);
  }
}

@Skill({
  name: SKILL_NAME,
  description: `The ${SKILL_NAME} routine`,
  instructions: 'Greet the user with the greet tool.',
  tools: ['greet'],
})
export class GreetingSkill {}

@Agent({
  name: 'concierge',
  description: 'Greets guests',
  inputSchema: { name: z.string() },
  llm: { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } },
})
export class ConciergeAgent extends AgentContext {
  override async execute({ name }: { name: string }) {
    return `The concierge says: ${this.get(GreetingService).greet(name)}`;
  }
}

@Job({
  name: 'welcome-batch',
  description: 'Greets a batch of guests',
  inputSchema: { names: z.array(z.string()) },
  outputSchema: { greeted: z.number(), version: z.string() },
})
export class WelcomeBatchJob extends JobContext {
  async execute({ names }: { names: string[] }) {
    return { greeted: names.length, version: PACKAGE_VERSION };
  }
}

@Workflow({
  name: 'welcome-flow',
  description: 'Greets the morning guests',
  steps: [{ id: 'batch', jobName: 'welcome-batch', input: { names: ['Ada', 'Grace'] } }],
})
export class WelcomeFlow {}
