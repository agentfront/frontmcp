import { RunJournal } from '../runs/run-journal';
import { RunSpans, type RunTelemetrySpan } from '../runs/run-spans';

function fakeSpan(): RunTelemetrySpan & { attributes: Record<string, unknown>; ended: string; children: unknown[] } {
  const span = {
    attributes: {} as Record<string, unknown>,
    ended: '',
    children: [] as unknown[],
    setAttributes(attributes: Record<string, unknown>) {
      Object.assign(span.attributes, attributes);
    },
    end() {
      span.ended = 'ok';
    },
    endWithError(error: string) {
      span.ended = `error: ${error}`;
    },
    startChildSpan(name: string, attributes?: Record<string, unknown>) {
      const child = fakeSpan();
      child.setAttributes({ name, ...attributes });
      span.children.push(child);
      return child;
    },
  };
  return span;
}

describe('RunSpans', () => {
  it('ends a call still running when the run ended as unfinished, without an error', () => {
    const runSpan = fakeSpan();
    const journal = new RunJournal({ observer: new RunSpans(runSpan) });
    journal.begin('reports.build', {});
    journal.close();

    expect(runSpan.children).toEqual([
      expect.objectContaining({
        ended: 'ok',
        attributes: expect.objectContaining({
          name: 'codecall call reports.build',
          'codecall.call.outcome': 'unfinished',
        }),
      }),
    ]);
  });

  it('puts the review decision on the run span once a review stage set one, and no run id when none was kept', () => {
    const runSpan = fakeSpan();
    const spans = new RunSpans(runSpan);
    spans.end(
      {
        scriptHash: 'a'.repeat(64),
        status: 'ok',
        startedAt: '2026-11-23T10:00:00.000Z',
        endedAt: '2026-11-23T10:00:00.010Z',
        reviewDecision: 'approved',
        resultBytes: 2,
        journal: [],
      },
      undefined,
    );

    expect(runSpan.attributes).toEqual({
      'codecall.run.status': 'ok',
      'codecall.run.calls': 0,
      'codecall.run.result_bytes': 2,
      'codecall.review.decision': 'approved',
    });
    expect(runSpan.ended).toBe('ok');
  });

  it('ignores the end of a call it never started', () => {
    const runSpan = fakeSpan();
    const spans = new RunSpans(runSpan);
    spans.callEnded({ position: 1, tool: 'a', argumentsHash: '', outcome: 'success', durationMs: 0 });

    expect(runSpan.children).toEqual([]);
  });
});
