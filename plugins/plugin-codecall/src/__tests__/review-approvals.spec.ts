import { ReviewApprovals, type ApprovalRecordView, type ApprovalServiceView } from '../review/review-approvals';
import { argumentsHashOf } from '../runs/run-journal';

const HOUR_MS = 60 * 60 * 1000;

function serviceWith(
  recordsById: Record<string, ApprovalRecordView[]>,
): ApprovalServiceView & { queryApprovals: jest.Mock } {
  return { queryApprovals: jest.fn(async ({ toolId }: { toolId: string }) => recordsById[toolId] ?? []) };
}

function approved(overrides: Partial<ApprovalRecordView> = {}): ApprovalRecordView {
  return { state: 'approved', scope: 'session', grantedAt: Date.now(), ...overrides };
}

function approvalsWith(
  service?: ApprovalServiceView,
  granted: string[] = [],
  approvalContext?: { type: string; identifier: string },
) {
  return new ReviewApprovals({
    scriptHash: 'a'.repeat(64),
    policyVersion: 'v1',
    maxAgeMs: HOUR_MS,
    service,
    approvalContext,
    granted: new Set(granted),
  });
}

const CALL = { toolName: 'users.close', args: { id: 'u1' } };

describe('ReviewApprovals', () => {
  it('names a call by script, tool, arguments and policy, and a script by script and policy', () => {
    const approvals = approvalsWith();
    const reference = approvals.referenceFor(CALL);

    expect(reference).toEqual({
      id: expect.stringMatching(/^codecall:approval:[0-9a-f]{64}$/),
      toolName: 'users.close',
      argumentsHash: argumentsHashOf({ id: 'u1' }),
      anyArgumentsId: expect.stringMatching(/^codecall:approval:[0-9a-f]{64}$/),
    });
    expect(approvals.referenceFor({ ...CALL, args: { id: 'u2' } }).id).not.toBe(reference.id);
    expect(approvals.referenceFor({ ...CALL, args: { id: 'u2' } }).anyArgumentsId).toBe(reference.anyArgumentsId);
    expect(approvals.referenceFor()).toEqual({ id: expect.stringMatching(/^codecall:approval:/) });
    const otherPolicy = new ReviewApprovals({
      scriptHash: 'a'.repeat(64),
      policyVersion: 'v2',
      maxAgeMs: HOUR_MS,
      granted: new Set(),
    });
    expect(otherPolicy.referenceFor(CALL).id).not.toBe(reference.id);
  });

  it('finds nothing without the Approval plugin, unless a person approved during the request', async () => {
    const reference = approvalsWith().referenceFor(CALL);

    expect(await approvalsWith().stateOf(reference, true)).toBe('missing');
    expect(await approvalsWith(undefined, [reference.id]).stateOf(reference, true)).toBe('approved');
  });

  it('finds an approval or a denial of the exact call', async () => {
    const reference = approvalsWith().referenceFor(CALL);

    expect(await approvalsWith(serviceWith({ [reference.id]: [approved()] })).stateOf(reference, false)).toBe(
      'approved',
    );
    expect(
      await approvalsWith(serviceWith({ [reference.id]: [approved(), approved({ state: 'denied' })] })).stateOf(
        reference,
        false,
      ),
    ).toBe('denied');
  });

  it('asks the store for approvals and denials, never expired ones, and ignores grants older than the max age', async () => {
    const reference = approvalsWith().referenceFor(CALL);
    const service = serviceWith({ [reference.id]: [approved({ grantedAt: Date.now() - 2 * HOUR_MS })] });

    expect(await approvalsWith(service).stateOf(reference, false)).toBe('missing');
    expect(service.queryApprovals).toHaveBeenCalledWith({
      toolId: reference.id,
      states: ['approved', 'denied'],
      includeExpired: false,
    });
  });

  it('counts a context-specific grant only in its context', async () => {
    const reference = approvalsWith().referenceFor(CALL);
    const context = { type: 'repo', identifier: 'crm' };
    const service = serviceWith({ [reference.id]: [approved({ scope: 'context_specific', context })] });

    expect(await approvalsWith(service, [], context).stateOf(reference, false)).toBe('approved');
    expect(await approvalsWith(service, [], { type: 'repo', identifier: 'other' }).stateOf(reference, false)).toBe(
      'missing',
    );
    expect(await approvalsWith(service).stateOf(reference, false)).toBe('missing');
  });

  it('lets a grant on any arguments cover up to its maxCalls calls of a run, counting only consumed ones', async () => {
    const reference = approvalsWith().referenceFor(CALL);
    const approvals = approvalsWith(
      serviceWith({ [reference.anyArgumentsId as string]: [approved({ metadata: { maxCalls: 2 } })] }),
    );

    expect(await approvals.stateOf(reference, false)).toBe('approved');
    expect(await approvals.stateOf(reference, true)).toBe('approved');
    expect(await approvals.stateOf(reference, true)).toBe('approved');
    expect(await approvals.stateOf(reference, true)).toBe('missing');
  });

  it('needs maxCalls on a grant for any arguments, and honors its denial', async () => {
    const reference = approvalsWith().referenceFor(CALL);
    const anyArgumentsId = reference.anyArgumentsId as string;

    expect(await approvalsWith(serviceWith({ [anyArgumentsId]: [approved()] })).stateOf(reference, true)).toBe(
      'missing',
    );
    expect(
      await approvalsWith(serviceWith({ [anyArgumentsId]: [approved({ metadata: { maxCalls: 1.5 } })] })).stateOf(
        reference,
        true,
      ),
    ).toBe('missing');
    expect(
      await approvalsWith(serviceWith({ [anyArgumentsId]: [approved({ state: 'denied' })] })).stateOf(reference, true),
    ).toBe('denied');
  });

  it('has no grant on any arguments for a script-wide reference', async () => {
    const approvals = approvalsWith(serviceWith({}));

    expect(await approvals.stateOf(approvals.referenceFor(), false)).toBe('missing');
  });
});
