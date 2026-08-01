import { InputRequiredSignal, MissingClientCapabilityError } from '../../../errors';
import { buildInputRequiredResult, decodeRequestState, encodeRequestState, MrtrExchange } from '../mrtr';

const ELICITATION_CAPABLE = { elicitation: { form: {} } };

const PENDING = {
  message: 'Proceed?',
  requestedSchema: { type: 'object', properties: { confirmed: { type: 'boolean' } } },
};

describe('requestState codec', () => {
  it('round-trips recorded responses', () => {
    const responses = { 'elicit-1': { action: 'accept', content: { confirmed: true } } };
    expect(decodeRequestState(encodeRequestState(responses))).toEqual(responses);
  });

  it('treats a malformed blob as no prior answers', () => {
    // The value is opaque to the client, so a bad one means tampering or
    // truncation — restarting the exchange beats failing the call.
    expect(decodeRequestState('not-base64url!!')).toEqual({});
    expect(decodeRequestState(undefined)).toEqual({});
    expect(decodeRequestState('')).toEqual({});
    expect(decodeRequestState(Buffer.from('[]', 'utf8').toString('base64url'))).toEqual({});
  });
});

describe('MrtrExchange', () => {
  it('raises InputRequiredSignal on the first unanswered elicitation', () => {
    const exchange = new MrtrExchange({ clientCapabilities: ELICITATION_CAPABLE });

    let signal: InputRequiredSignal | undefined;
    try {
      exchange.resolveElicitation(PENDING);
    } catch (error) {
      signal = error as InputRequiredSignal;
    }

    expect(signal).toBeInstanceOf(InputRequiredSignal);
    expect(signal?.inputRequests['elicit-1']).toMatchObject({
      method: 'elicitation/create',
      params: { message: 'Proceed?' },
    });
    expect(typeof signal?.requestState).toBe('string');
  });

  it('returns a recorded answer instead of asking again', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicit-1': { action: 'accept', content: { confirmed: true } } },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });

  it('accepts the `status` spelling as well as `action`', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicit-1': { status: 'decline' } },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'decline' });
  });

  it('defaults an answer with no action to cancel', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicit-1': {} },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'cancel' });
  });

  it('derives keys from call order so a replayed tool lines up', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: {
        'elicit-1': { action: 'accept', content: { step: 1 } },
        'elicit-2': { action: 'accept', content: { step: 2 } },
      },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 1 } });
    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 2 } });
  });

  it('asks for the next step once earlier answers are exhausted', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicit-1': { action: 'accept', content: { step: 1 } } },
    });

    exchange.resolveElicitation(PENDING);
    expect(() => exchange.resolveElicitation(PENDING)).toThrow(InputRequiredSignal);
  });

  it('carries earlier answers forward through requestState', () => {
    const first = { 'elicit-1': { action: 'accept', content: { step: 1 } } };
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      carriedResponses: first,
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 1 } });

    // The follow-up ask must re-encode what we already know, or a multi-step
    // tool would never converge.
    try {
      exchange.resolveElicitation(PENDING);
      throw new Error('expected InputRequiredSignal');
    } catch (error) {
      expect(decodeRequestState((error as InputRequiredSignal).requestState)).toEqual(first);
    }
  });

  it('lets a fresh inputResponse win over a carried one', () => {
    const exchange = new MrtrExchange({
      clientCapabilities: ELICITATION_CAPABLE,
      carriedResponses: { 'elicit-1': { action: 'decline' } },
      inputResponses: { 'elicit-1': { action: 'accept', content: { confirmed: true } } },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });

  it('demands the elicitation capability before asking', () => {
    const exchange = new MrtrExchange({ clientCapabilities: {} });

    let error: unknown;
    try {
      exchange.resolveElicitation(PENDING);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MissingClientCapabilityError);
    expect((error as MissingClientCapabilityError).requiredCapabilities).toEqual({ elicitation: { form: {} } });
  });

  it('still resolves a recorded answer without the capability declared', () => {
    // The client already answered — refusing now would strand a valid retry.
    const exchange = new MrtrExchange({
      clientCapabilities: {},
      inputResponses: { 'elicit-1': { action: 'accept', content: { confirmed: true } } },
    });

    expect(exchange.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });
});

describe('buildInputRequiredResult', () => {
  it('produces the interim result envelope', () => {
    const signal = new InputRequiredSignal({ 'elicit-1': { method: 'elicitation/create', params: {} } }, 'state-blob');

    expect(buildInputRequiredResult(signal)).toEqual({
      resultType: 'input_required',
      inputRequests: { 'elicit-1': { method: 'elicitation/create', params: {} } },
      requestState: 'state-blob',
    });
  });
});
