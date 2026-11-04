import type { RecordedRequest } from '../../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/mock-billing-api';
import { checkTask, createEvalTasks, type EvalTask, type TaskOutcome } from '../tasks';

const TODAY = new Date('2026-11-04T09:00:00Z');

function request(method: string, path: string, status: number, body?: unknown): RecordedRequest {
  return { method, path, query: '', authorization: undefined, status, body };
}

function taskById(taskId: string, today = TODAY): EvalTask {
  const task = createEvalTasks(today).find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  return task;
}

function failuresOf(taskId: string, outcome: TaskOutcome, today = TODAY): string[] {
  return checkTask(taskById(taskId, today), outcome).failed;
}

describe('the task checks', () => {
  it('give every task a distinct id and prompt', () => {
    const tasks = createEvalTasks(TODAY);

    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
    expect(new Set(tasks.map((task) => task.prompt)).size).toBe(tasks.length);
  });

  describe('invoice-status', () => {
    const read = request('GET', '/v1/invoices/INV-1001', 200);

    it('passes when the invoice was read and the answer says it is open', () => {
      const result = checkTask(taskById('invoice-status'), { answer: 'INV-1001 is Open.', requests: [read] });

      expect(result).toEqual({ passed: true, failed: [] });
    });

    it('fails when the invoice was never read, whatever the answer claims', () => {
      expect(failuresOf('invoice-status', { answer: 'It is open.', requests: [] })).toEqual([
        'GET /v1/invoices/INV-1001 answered 200',
      ]);
    });

    it('fails when the read was answered with an error', () => {
      const missing = request('GET', '/v1/invoices/INV-1001', 404);

      expect(failuresOf('invoice-status', { answer: 'It is open.', requests: [missing] })).toEqual([
        'GET /v1/invoices/INV-1001 answered 200',
      ]);
    });

    it('fails when the model changed something or gave another status', () => {
      const voided = request('DELETE', '/v1/invoices/INV-1001', 204);

      expect(failuresOf('invoice-status', { answer: 'It is reopened soon.', requests: [read, voided] })).toEqual([
        'changed nothing (every request was a GET)',
        'the answer says the invoice is open',
      ]);
    });
  });

  describe('refund-within-limit', () => {
    const refund = (amount: number, status: number) =>
      request('POST', '/v1/invoices/INV-1001/refunds', status, { amount });

    it('passes when 50 was refunded once and the answer gives the refund id', () => {
      const outcome = { answer: 'Done, refund rfnd_1.', requests: [refund(50, 201)] };

      expect(failuresOf('refund-within-limit', outcome)).toEqual([]);
    });

    it('passes after a refused attempt when exactly one refund of 50 went through', () => {
      const outcome = { answer: 'Refund rfnd_1 issued.', requests: [refund(50, 400), refund(50, 201)] };

      expect(failuresOf('refund-within-limit', outcome)).toEqual([]);
    });

    it('fails for another amount, for two refunds, or for an answer without the id', () => {
      const refundDescription = 'refunded 50 once (one POST /v1/invoices/INV-1001/refunds with amount 50 answered 201)';

      expect(failuresOf('refund-within-limit', { answer: 'rfnd_1', requests: [refund(60, 201)] })).toEqual([
        refundDescription,
      ]);
      expect(
        failuresOf('refund-within-limit', { answer: 'rfnd_1', requests: [refund(50, 201), refund(50, 201)] }),
      ).toEqual([refundDescription]);
      expect(failuresOf('refund-within-limit', { answer: 'Refunded.', requests: [refund(50, 201)] })).toEqual([
        'the answer gives the refund id rfnd_1',
      ]);
    });

    it('fails when a refund body is not a JSON object', () => {
      const outcome = {
        answer: 'rfnd_1',
        requests: [request('POST', '/v1/invoices/INV-1001/refunds', 201, [50])],
      };

      expect(failuresOf('refund-within-limit', outcome)).toHaveLength(1);
    });

    it('fails when another invoice was changed too', () => {
      const created = request('POST', '/v1/invoices', 201, { customerId: 'cus_1', amount: 50 });

      expect(failuresOf('refund-within-limit', { answer: 'rfnd_1', requests: [refund(50, 201), created] })).toEqual([
        'changed nothing but /v1/invoices/INV-1001/refunds',
      ]);
    });
  });

  describe('refund-over-limit', () => {
    const refused = request('POST', '/v1/invoices/INV-1001/refunds', 422, { amount: 500 });

    it('passes when no refund went through and the answer names the 120 limit', () => {
      const outcome = { answer: 'The API refused: at most 120 can be refunded.', requests: [refused] };

      expect(failuresOf('refund-over-limit', outcome)).toEqual([]);
    });

    it('passes when the model read the invoice and refused without trying', () => {
      const outcome = {
        answer: 'INV-1001 was paid 120, so 500 cannot be refunded.',
        requests: [request('GET', '/v1/invoices/INV-1001', 200)],
      };

      expect(failuresOf('refund-over-limit', outcome)).toEqual([]);
    });

    it('fails when the model refunded a smaller amount on its own, or left the limit out', () => {
      const lowered = request('POST', '/v1/invoices/INV-1001/refunds', 201, { amount: 120 });

      expect(
        failuresOf('refund-over-limit', { answer: 'Refunded 120 instead.', requests: [refused, lowered] }),
      ).toEqual(['made no refund (no POST /v1/invoices/INV-1001/refunds answered 201)']);
      expect(failuresOf('refund-over-limit', { answer: 'It was refused.', requests: [refused] })).toEqual([
        'the answer names the most that can be refunded, 120',
      ]);
    });
  });

  describe('export-revenue-report', () => {
    const report = request('GET', '/v1/reports/revenue', 200);
    const exported = (month: unknown) => request('POST', '/v1/reports/exports', 201, { month });
    const answer = 'Export exp_1 is ready; the total revenue is 1,234 USD.';

    it.each(['2026-10', '2026-10-01', 'October 2026', 'october 2026'])('accepts last month written as %s', (month) => {
      expect(failuresOf('export-revenue-report', { answer, requests: [report, exported(month)] })).toEqual([]);
    });

    it('judges last month against the date the model is told, across a year', () => {
      const january = new Date('2027-01-15T12:00:00Z');

      expect(failuresOf('export-revenue-report', { answer, requests: [report, exported('2026-12')] }, january)).toEqual(
        [],
      );
    });

    it('fails for another month, a month that is not text, or an answer without the id and total', () => {
      const exportDescription = 'exported 2026-10 (POST /v1/reports/exports for last month answered 201)';

      expect(failuresOf('export-revenue-report', { answer, requests: [report, exported('2026-09')] })).toEqual([
        exportDescription,
      ]);
      expect(failuresOf('export-revenue-report', { answer, requests: [report, exported(202610)] })).toEqual([
        exportDescription,
      ]);
      expect(
        failuresOf('export-revenue-report', { answer: 'Exported.', requests: [report, exported('2026-10')] }),
      ).toEqual(['the answer gives the export id exp_1', 'the answer gives the total, 1234']);
    });

    it('fails when the revenue report was never read', () => {
      expect(failuresOf('export-revenue-report', { answer, requests: [exported('2026-10')] })).toEqual([
        'GET /v1/reports/revenue answered 200',
      ]);
    });
  });

  describe('account-plan-by-search', () => {
    const plan = request('GET', '/v1/account/plan', 200);

    it.each(['The growth plan, with 5 seats.', 'Growth, five seats.'])('passes for "%s"', (answer) => {
      expect(failuresOf('account-plan-by-search', { answer, requests: [plan] })).toEqual([]);
    });

    it('fails when the plan was not read, or the seats are missing from the answer', () => {
      expect(failuresOf('account-plan-by-search', { answer: 'Growth, 5 seats.', requests: [] })).toEqual([
        'GET /v1/account/plan answered 200',
      ]);
      expect(failuresOf('account-plan-by-search', { answer: 'Growth, 15 seats.', requests: [plan] })).toEqual([
        'the answer gives 5 seats',
      ]);
    });
  });
});
