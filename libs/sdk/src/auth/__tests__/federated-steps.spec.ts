/**
 * answerFederatedStep: how one page of the step-by-step provider picker changes the pending authorization.
 */
import { type PendingAuthorizationRecord } from '@frontmcp/auth';

import { answerFederatedStep } from '../federated-steps';

function record(currentStep = 0): PendingAuthorizationRecord {
  return {
    id: 'pending-1',
    clientId: 'desk-client',
    redirectUri: 'http://127.0.0.1:5555/cb',
    scopes: [],
    pkce: { challenge: 'x'.repeat(43), method: 'S256' },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    federatedLogin: {
      providerIds: ['__parent__', 'tasks', 'crm'],
      selectedProviderIds: [],
      skippedProviderIds: [],
      currentStep,
    },
  };
}

const RULES = { requiredProviderIds: [] as string[], minProviders: 1 };

describe('answerFederatedStep', () => {
  it('links the provider on continue and moves to the next step', () => {
    const pending = record();

    const outcome = answerFederatedStep(pending, { step: '0', action: 'continue' }, RULES);

    expect(outcome).toEqual({ kind: 'show' });
    expect(pending.federatedLogin).toMatchObject({ currentStep: 1, selectedProviderIds: ['__parent__'] });
  });

  it('records a skip and moves to the next step', () => {
    const pending = record(1);
    pending.federatedLogin?.selectedProviderIds?.push('__parent__');

    answerFederatedStep(pending, { step: '1', action: 'skip' }, RULES);

    expect(pending.federatedLogin).toMatchObject({ currentStep: 2, skippedProviderIds: ['tasks'] });
  });

  it('goes back one step, and an answer given again replaces the earlier one', () => {
    const pending = record(1);
    pending.federatedLogin?.selectedProviderIds?.push('__parent__');
    answerFederatedStep(pending, { step: '1', action: 'skip' }, RULES);

    answerFederatedStep(pending, { step: '2', action: 'back' }, RULES);
    answerFederatedStep(pending, { step: '1', action: 'continue' }, RULES);

    expect(pending.federatedLogin).toMatchObject({
      currentStep: 2,
      selectedProviderIds: ['__parent__', 'tasks'],
      skippedProviderIds: [],
    });
  });

  it('stays on the first step on back', () => {
    const pending = record();

    expect(answerFederatedStep(pending, { step: '0', action: 'back' }, RULES)).toEqual({ kind: 'show' });
    expect(pending.federatedLogin?.currentStep).toBe(0);
  });

  it('finishes on the last step with the linked providers in picker order', () => {
    const pending = record(2);
    pending.federatedLogin?.selectedProviderIds?.push('tasks', '__parent__');

    const outcome = answerFederatedStep(pending, { step: '2', action: 'continue' }, RULES);

    expect(outcome).toEqual({ kind: 'done', selectedProviderIds: ['__parent__', 'tasks', 'crm'] });
    expect(pending.federatedLogin?.currentStep).toBe(2);
  });

  it('shows the current step again, unanswered, for an answer to another step', () => {
    const pending = record(1);

    expect(answerFederatedStep(pending, { step: '0', action: 'continue' }, RULES)).toEqual({ kind: 'show' });
    expect(answerFederatedStep(pending, { action: 'continue' }, RULES)).toEqual({ kind: 'show' });
    expect(pending.federatedLogin).toMatchObject({ currentStep: 1, selectedProviderIds: [] });
  });

  it('refuses an unknown action', () => {
    expect(answerFederatedStep(record(), { step: '0', action: 'link-all' }, RULES)).toEqual({
      kind: 'refuse',
      message: 'Invalid step action',
    });
  });

  it('refuses to skip a required provider, and changes nothing', () => {
    const pending = record(1);

    const outcome = answerFederatedStep(
      pending,
      { step: '1', action: 'skip' },
      { requiredProviderIds: ['tasks'], minProviders: 1 },
    );

    expect(outcome).toEqual({ kind: 'refuse', message: 'Required provider(s) not linked: tasks' });
    expect(pending.federatedLogin).toMatchObject({ currentStep: 1, skippedProviderIds: [] });
  });

  it('refuses a skip that leaves too few providers to reach minProviders', () => {
    const pending = record(1);
    pending.federatedLogin?.selectedProviderIds?.push('__parent__');

    const outcome = answerFederatedStep(
      pending,
      { step: '1', action: 'skip' },
      { requiredProviderIds: [], minProviders: 3 },
    );

    expect(outcome).toEqual({ kind: 'refuse', message: 'At least 3 providers must be linked' });
  });

  it('refuses a record that is not on the step-by-step picker', () => {
    const pending = record();
    delete pending.federatedLogin?.currentStep;

    expect(answerFederatedStep(pending, { step: '0', action: 'continue' }, RULES).kind).toBe('refuse');
  });
});
