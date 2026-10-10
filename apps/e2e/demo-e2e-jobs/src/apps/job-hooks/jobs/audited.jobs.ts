import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext, Workflow } from '@frontmcp/sdk';

@Job({
  name: 'audited-greet',
  description: 'Greets a person; audited by the job-audit plugin',
  inputSchema: { name: z.string() },
  outputSchema: { message: z.string() },
})
export class AuditedGreetJob extends JobContext {
  async execute({ name }: { name: string }) {
    return { message: `Hello, ${name}!` };
  }
}

@Job({
  name: 'flaky-count',
  description: 'Fails its first two attempts, then succeeds',
  inputSchema: {},
  outputSchema: { attempt: z.number() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
export class FlakyCountJob extends JobContext {
  async execute() {
    if (this.attempt < 3) throw new Error(`attempt ${this.attempt} failed`);
    return { attempt: this.attempt };
  }
}

@Workflow({
  name: 'audited-flow',
  description: 'Greets, then runs the flaky job',
  steps: [
    { id: 'greet', jobName: 'audited-greet', input: { name: 'Workflow' } },
    { id: 'count', jobName: 'flaky-count', dependsOn: ['greet'], retry: { maxAttempts: 3, backoffMs: 1 } },
  ],
})
export class AuditedFlowWorkflow {}
