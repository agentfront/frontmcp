import type { AuthBinding } from '@frontmcp/adapters/skills';

import { actionFailureMessage, actionOutcome, MAX_ERROR_BODY_LENGTH } from '../action-outcome';

const noAuth: AuthBinding = { kind: 'none' };
const refundTooLarge = {
  error: 'refund_too_large',
  message: 'Refund 500 exceeds the paid amount 120.',
  maxRefund: 120,
};

describe('actionOutcome', () => {
  it('passes a successful answer through with its status', () => {
    expect(actionOutcome({ ok: true, status: 200, data: { id: 'inv_1' } }, 'include', noAuth)).toEqual({
      ok: true,
      status: 200,
      data: { id: 'inv_1' },
    });
  });

  it('gives a bodyless success no data', () => {
    expect(actionOutcome({ ok: true, status: 204 }, 'include', noAuth)).toEqual({ ok: true, status: 204 });
  });

  it('keeps the reason of a failure that has no answer', () => {
    expect(actionOutcome({ ok: false, status: 0, error: 'timeout after 250ms' }, 'include', noAuth)).toEqual({
      ok: false,
      status: 0,
      error: 'timeout after 250ms',
    });
  });

  it("gives an HTTP failure the API's JSON error body as data", () => {
    expect(actionOutcome({ ok: false, status: 422, data: refundTooLarge }, 'include', noAuth)).toEqual({
      ok: false,
      status: 422,
      data: refundTooLarge,
    });
  });

  it("gives an HTTP failure the API's text error body as it is", () => {
    expect(actionOutcome({ ok: false, status: 503, data: 'Down for maintenance.\n' }, 'include', noAuth)).toEqual({
      ok: false,
      status: 503,
      data: 'Down for maintenance.\n',
    });
  });

  it('cuts a body longer than the cap, as text ending in an ellipsis', () => {
    const body = { error: 'too_many_items', items: Array.from({ length: 400 }, (_, index) => `item-${index}`) };

    const outcome = actionOutcome({ ok: false, status: 400, data: body }, 'include', noAuth);

    expect(outcome.data).toBe(`${JSON.stringify(body).slice(0, MAX_ERROR_BODY_LENGTH)}…`);
  });

  it('keeps a body of exactly the cap whole', () => {
    const body = 'x'.repeat(MAX_ERROR_BODY_LENGTH);

    expect(actionOutcome({ ok: false, status: 400, data: body }, 'include', noAuth).data).toBe(body);
  });

  it('leaves out an empty body', () => {
    expect(actionOutcome({ ok: false, status: 404, data: '' }, 'include', noAuth)).toEqual({ ok: false, status: 404 });
    expect(actionOutcome({ ok: false, status: 404 }, 'include', noAuth)).toEqual({ ok: false, status: 404 });
  });

  it("leaves out the body with errorBodies 'status-only'", () => {
    expect(actionOutcome({ ok: false, status: 422, data: refundTooLarge }, 'status-only', noAuth)).toEqual({
      ok: false,
      status: 422,
    });
  });

  it('redacts a credential the API echoes back, in the field the operation sends it in', () => {
    const apiKey: AuthBinding = { kind: 'apiKey', in: 'header', name: 'X-Api-Key', vaultRef: 'billing-key' };
    const echoed = { error: 'bad request', headers: { 'x-api-key': 'sk_live_abcdef123456' } };

    expect(actionOutcome({ ok: false, status: 400, data: echoed }, 'include', apiKey).data).toEqual({
      error: 'bad request',
      headers: { 'x-api-key': '[REDACTED]' },
    });
  });

  it('redacts a bearer credential and a JWT in a text body', () => {
    const bearer: AuthBinding = { kind: 'bearer', vaultRef: 'billing-token' };
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl';
    const body = `rejected Bearer sk_live_abcdef123456 and token ${jwt}`;

    const data = actionOutcome({ ok: false, status: 401, data: body }, 'include', bearer).data;

    expect(data).toBe('rejected Bearer [REDACTED] and token [REDACTED]');
  });
});

describe('actionFailureMessage', () => {
  it("names the status and the API's JSON error body, compacted", () => {
    const outcome = actionOutcome({ ok: false, status: 422, data: refundTooLarge }, 'include', noAuth);

    expect(actionFailureMessage('refundInvoice', outcome)).toBe(
      'action "refundInvoice" failed with status 422: {"error":"refund_too_large","message":"Refund 500 exceeds the paid amount 120.","maxRefund":120}',
    );
  });

  it("names the status and the API's text error body", () => {
    expect(actionFailureMessage('getStatus', { ok: false, status: 503, data: 'Down for maintenance.' })).toBe(
      'action "getStatus" failed with status 503: Down for maintenance.',
    );
  });

  it('names the status alone when there is no body', () => {
    expect(actionFailureMessage('getInvoice', { ok: false, status: 404 })).toBe(
      'action "getInvoice" failed with status 404',
    );
  });

  it('is the reason of a failure that has no answer', () => {
    expect(actionFailureMessage('getInvoice', { ok: false, status: 0, error: 'authority denied: admin' })).toBe(
      'authority denied: admin',
    );
  });
});
