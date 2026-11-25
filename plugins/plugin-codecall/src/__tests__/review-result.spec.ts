import { unpausedResultOf } from '../review/review-result';
import type { PendingApproval } from '../review/run-review';

const pending: PendingApproval = {
  reference: { id: 'codecall:approval:x', toolName: 'users.close' },
  call: { toolName: 'users.close', args: { id: 'u1' } },
};

describe('unpausedResultOf', () => {
  it('asks for its own script for an approval after effects in a run that was not kept paused', () => {
    const result = unpausedResultOf({ status: 'needs_approval', reason: 'destructive' }, pending, ['mail.send']);

    expect(result).toEqual({
      status: 'needs_changes',
      findings: [expect.objectContaining({ rule: 'approval-after-effects', toolName: 'users.close' })],
    });
  });

  it('keeps an approval with no effects before it, and any other result', () => {
    const asked = { status: 'needs_approval' as const, reason: 'destructive' };

    expect(unpausedResultOf(asked, pending, [])).toBe(asked);
    expect(unpausedResultOf({ status: 'ok', result: 1 }, pending, ['mail.send'])).toEqual({ status: 'ok', result: 1 });
  });
});
