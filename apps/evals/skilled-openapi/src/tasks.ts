import type { MockInvoice, RecordedRequest } from '../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/mock-billing-api';
import type { Script } from './scripted-model';

/** What a task is judged on: the model's final answer and the requests that reached the billing API. */
export interface TaskOutcome {
  answer: string;
  requests: readonly RecordedRequest[];
}

export interface Expectation {
  description: string;
  holds(outcome: TaskOutcome): boolean;
}

export interface EvalTask {
  id: string;
  prompt: string;
  expectations: Expectation[];
  /** Tool calls that complete the task, which the dry run plays in place of a model. */
  dryRun: Script;
}

export interface CheckResult {
  passed: boolean;
  /** The expectations that didn't hold. */
  failed: string[];
}

/** The invoice the tasks ask about, which the billing API holds at the start of each task. */
export const INVOICE: MockInvoice = { id: 'INV-1001', status: 'open', amount: 120 };

const INVOICE_PATH = `/v1/invoices/${INVOICE.id}`;
const REFUNDS_PATH = `${INVOICE_PATH}/refunds`;
const EXPORTS_PATH = '/v1/reports/exports';

export function checkTask(task: EvalTask, outcome: TaskOutcome): CheckResult {
  const failed = task.expectations
    .filter((expectation) => !expectation.holds(outcome))
    .map((expectation) => expectation.description);
  return { passed: failed.length === 0, failed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bodyField(request: RecordedRequest, field: string): unknown {
  return isRecord(request.body) ? request.body[field] : undefined;
}

function isAnswered(request: RecordedRequest, method: string, path: string, status: number): boolean {
  return request.method === method && request.path === path && request.status === status;
}

function answered(method: string, path: string, status: number): Expectation {
  return {
    description: `${method} ${path} answered ${status}`,
    holds: ({ requests }) => requests.some((request) => isAnswered(request, method, path, status)),
  };
}

function answerMatches(pattern: RegExp, description: string): Expectation {
  return { description, holds: ({ answer }) => pattern.test(answer) };
}

const changedNothing: Expectation = {
  description: 'changed nothing (every request was a GET)',
  holds: ({ requests }) => requests.every((request) => request.method === 'GET'),
};

function changedOnly(path: string): Expectation {
  return {
    description: `changed nothing but ${path}`,
    holds: ({ requests }) => requests.every((request) => request.method === 'GET' || request.path === path),
  };
}

function refunds(requests: readonly RecordedRequest[], status: number): RecordedRequest[] {
  return requests.filter((request) => isAnswered(request, 'POST', REFUNDS_PATH, status));
}

function previousMonth(today: Date): { iso: string; name: string } {
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return {
    iso: month.toISOString().slice(0, 7),
    name: month.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** The tasks, judged against `today`, the date the model is told. */
export function createEvalTasks(today: Date): EvalTask[] {
  const lastMonth = previousMonth(today);
  const namesLastMonth = (value: unknown) =>
    typeof value === 'string' &&
    (value.startsWith(lastMonth.iso) || value.toLowerCase() === lastMonth.name.toLowerCase());

  return [
    {
      id: 'invoice-status',
      prompt: `What's the status of invoice ${INVOICE.id}?`,
      expectations: [
        answered('GET', INVOICE_PATH, 200),
        changedNothing,
        answerMatches(/\bopen\b/i, 'the answer says the invoice is open'),
      ],
      dryRun: {
        turns: [
          [{ name: 'load_skill', input: { skillId: 'invoices' } }],
          [{ name: 'execute_action', input: { actionId: 'getInvoice', input: { id: INVOICE.id } } }],
        ],
        answer: `Invoice ${INVOICE.id} is open.`,
      },
    },
    {
      id: 'refund-within-limit',
      prompt: `Refund 50 from invoice ${INVOICE.id} and tell me the refund id.`,
      expectations: [
        {
          description: `refunded 50 once (one POST ${REFUNDS_PATH} with amount 50 answered 201)`,
          holds: ({ requests }) => {
            const made = refunds(requests, 201);
            return made.length === 1 && made.every((request) => bodyField(request, 'amount') === 50);
          },
        },
        changedOnly(REFUNDS_PATH),
        answerMatches(/\brfnd_1\b/, 'the answer gives the refund id rfnd_1'),
      ],
      dryRun: {
        turns: [
          [{ name: 'load_skill', input: { skillId: 'invoices' } }],
          [{ name: 'execute_action', input: { actionId: 'refundInvoice', input: { id: INVOICE.id, amount: 50 } } }],
        ],
        answer: `Refunded 50 from invoice ${INVOICE.id}: the refund id is rfnd_1.`,
      },
    },
    {
      id: 'refund-over-limit',
      prompt: `Refund 500 from invoice ${INVOICE.id}.`,
      expectations: [
        {
          description: `made no refund (no POST ${REFUNDS_PATH} answered 201)`,
          holds: ({ requests }) => refunds(requests, 201).length === 0,
        },
        changedOnly(REFUNDS_PATH),
        answerMatches(
          new RegExp(`\\b${INVOICE.amount}\\b`),
          `the answer names the most that can be refunded, ${INVOICE.amount}`,
        ),
      ],
      dryRun: {
        turns: [
          [{ name: 'load_skill', input: { skillId: 'invoices' } }],
          [{ name: 'execute_action', input: { actionId: 'refundInvoice', input: { id: INVOICE.id, amount: 500 } } }],
        ],
        answer: `The billing API refused the refund: 500 exceeds the paid amount, so at most ${INVOICE.amount} can be refunded.`,
      },
    },
    {
      id: 'export-revenue-report',
      prompt: "Export last month's revenue report, and tell me the export id and the total revenue.",
      expectations: [
        {
          description: `exported ${lastMonth.iso} (POST ${EXPORTS_PATH} for last month answered 201)`,
          holds: ({ requests }) =>
            requests.some(
              (request) =>
                isAnswered(request, 'POST', EXPORTS_PATH, 201) && namesLastMonth(bodyField(request, 'month')),
            ),
        },
        answered('GET', '/v1/reports/revenue', 200),
        changedOnly(EXPORTS_PATH),
        answerMatches(/\bexp_1\b/, 'the answer gives the export id exp_1'),
        answerMatches(/\b1,?234\b/, 'the answer gives the total, 1234'),
      ],
      dryRun: {
        turns: [
          [{ name: 'load_skill', input: { skillId: 'reports' } }],
          [
            {
              name: 'run_workflow',
              input: {
                script: [
                  "const report = await callTool('getRevenueReport', {});",
                  `const exported = await callTool('exportRevenueReport', { month: '${lastMonth.iso}' });`,
                  'return { total: report.total, currency: report.currency, exportId: exported.exportId };',
                ].join('\n'),
              },
            },
          ],
        ],
        answer: `Exported the ${lastMonth.name} revenue report as exp_1. The total revenue is 1234 USD.`,
      },
    },
    {
      id: 'account-plan-by-search',
      prompt: 'Which plan is the billing account on, and how many seats does it have?',
      expectations: [
        answered('GET', '/v1/account/plan', 200),
        changedNothing,
        answerMatches(/\bgrowth\b/i, 'the answer names the growth plan'),
        answerMatches(/\b(5|five)\b/i, 'the answer gives 5 seats'),
      ],
      dryRun: {
        turns: [
          [{ name: 'search_skill', input: { query: 'account plan seats' } }],
          [{ name: 'load_skill', input: { skillId: 'reports' } }],
          [{ name: 'execute_action', input: { actionId: 'getAccountPlan', input: {} } }],
        ],
        answer: 'The account is on the growth plan, with 5 seats.',
      },
    },
  ];
}
