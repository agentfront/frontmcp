import type { RecordedRequest } from '../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/mock-billing-api';
import type { EvalEnvironment } from './environment';
import { measureTask, totalMetrics, type SuiteTotals, type TaskMetrics } from './metrics';
import type { EvalModel } from './model';
import { runTask, type TaskTranscript } from './run-task';
import { checkTask, type CheckResult, type EvalTask } from './tasks';

/** A request the billing API received, without the credential it carried. */
export type ApiRequest = Omit<RecordedRequest, 'authorization'>;

export interface TaskResult {
  id: string;
  prompt: string;
  check: CheckResult;
  metrics: TaskMetrics;
  transcript: TaskTranscript;
  apiRequests: ApiRequest[];
}

export interface EvalReport {
  model: string;
  startedAt: string;
  maxTurns: number;
  tasks: TaskResult[];
  totals: SuiteTotals;
}

export interface RunSuiteOptions {
  model: EvalModel;
  environment: EvalEnvironment;
  tasks: readonly EvalTask[];
  maxTurns: number;
  /** The date the model is told, which the tasks are judged against. */
  today: Date;
}

/** What a host tells the model about the server: the same for every task, so the API caches it. */
export function systemPrompt(serverName: string, instructions: string, today: Date): string {
  return [
    `You are connected to the MCP server "${serverName}". Do what the user asks with its tools, then answer in a few sentences with what the tools returned. No one can answer questions, so don't ask any.`,
    `Today is ${today.toISOString().slice(0, 10)}.`,
    instructions,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/** Runs each task in a new MCP session against a billing API reset to its seeded state. */
export async function runSuite({ model, environment, tasks, maxTurns, today }: RunSuiteOptions): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const results: TaskResult[] = [];
  for (const task of tasks) {
    environment.billingApi.reset();
    const session = await environment.connect();
    try {
      const transcript = await runTask({
        model,
        system: systemPrompt(session.serverName, session.instructions, today),
        tools: session.tools,
        callTool: session.callTool,
        prompt: task.prompt,
        maxTurns,
      });
      const requests = [...environment.billingApi.requests];
      results.push({
        id: task.id,
        prompt: task.prompt,
        check: checkTask(task, { answer: transcript.answer, requests }),
        metrics: measureTask(transcript),
        transcript,
        apiRequests: requests.map(({ authorization: _credential, ...request }) => request),
      });
    } finally {
      await session.close();
    }
  }
  return { model: model.id, startedAt, maxTurns, tasks: results, totals: totalMetrics(results) };
}
