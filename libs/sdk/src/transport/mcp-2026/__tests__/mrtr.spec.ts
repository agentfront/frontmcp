import { InputRequiredSignal, MissingClientCapabilityError } from '../../../errors';
import { buildInputRequiredResult, MrtrExchange } from '../mrtr';
import { computeRequestBinding, decodeRequestState, type RequestStateBinding } from '../request-state';

const BINDING: RequestStateBinding = {
  principal: 'user-1',
  binding: computeRequestBinding('tools/call', { name: 'confirm', arguments: { action: 'deploy' } }),
};

const ELICITATION_CAPABLE = { elicitation: { form: {} } };
const SAMPLING_CAPABLE = { sampling: {} };
const ROOTS_CAPABLE = { roots: {} };

const PENDING = {
  message: 'Proceed?',
  requestedSchema: { type: 'object', properties: { confirmed: { type: 'boolean' } } },
};

const SAMPLE = {
  messages: [{ role: 'user', content: { type: 'text', text: 'Capital of France?' } }],
  maxTokens: 100,
};

function exchange(overrides: Partial<ConstructorParameters<typeof MrtrExchange>[0]> = {}) {
  return new MrtrExchange({ clientCapabilities: {}, binding: BINDING, ...overrides });
}

function capture(fn: () => unknown): InputRequiredSignal {
  try {
    fn();
  } catch (error) {
    if (error instanceof InputRequiredSignal) return error;
    throw error;
  }
  throw new Error('expected InputRequiredSignal');
}

describe('MrtrExchange — elicitation', () => {
  it('raises InputRequiredSignal on the first unanswered elicitation', () => {
    const signal = capture(() => exchange({ clientCapabilities: ELICITATION_CAPABLE }).resolveElicitation(PENDING));

    expect(signal.inputRequests['elicitation-1']).toMatchObject({
      method: 'elicitation/create',
      params: { message: 'Proceed?' },
    });
    expect(typeof signal.requestState).toBe('string');
  });

  it('returns a recorded answer instead of asking again', () => {
    const ex = exchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicitation-1': { action: 'accept', content: { confirmed: true } } },
    });

    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });

  it('accepts the `status` spelling as well as `action`', () => {
    const ex = exchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicitation-1': { status: 'decline' } },
    });

    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'decline' });
  });

  it('defaults an answer with no action to cancel', () => {
    const ex = exchange({ clientCapabilities: ELICITATION_CAPABLE, inputResponses: { 'elicitation-1': {} } });
    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'cancel' });
  });

  it('derives keys from call order so a replayed tool lines up', () => {
    const ex = exchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: {
        'elicitation-1': { action: 'accept', content: { step: 1 } },
        'elicitation-2': { action: 'accept', content: { step: 2 } },
      },
    });

    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 1 } });
    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 2 } });
  });

  it('asks for the next step once earlier answers are exhausted', () => {
    const ex = exchange({
      clientCapabilities: ELICITATION_CAPABLE,
      inputResponses: { 'elicitation-1': { action: 'accept', content: { step: 1 } } },
    });

    ex.resolveElicitation(PENDING);
    expect(() => ex.resolveElicitation(PENDING)).toThrow(InputRequiredSignal);
  });

  it('carries earlier answers forward through requestState', () => {
    const first = { 'elicitation-1': { action: 'accept', content: { step: 1 } } };
    const ex = exchange({ clientCapabilities: ELICITATION_CAPABLE, carriedResponses: first });

    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { step: 1 } });

    // The follow-up ask must re-encode what we already know, or a multi-step
    // tool would never converge.
    const signal = capture(() => ex.resolveElicitation(PENDING));
    expect(decodeRequestState(signal.requestState, BINDING)).toEqual({ ok: true, responses: first });
  });

  it('lets a fresh inputResponse win over a carried one', () => {
    const ex = exchange({
      clientCapabilities: ELICITATION_CAPABLE,
      carriedResponses: { 'elicitation-1': { action: 'decline' } },
      inputResponses: { 'elicitation-1': { action: 'accept', content: { confirmed: true } } },
    });

    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });

  it('demands the elicitation capability before asking', () => {
    // The spec forbids emitting an inputRequests entry the client never said it
    // supports, so this must fail rather than ask.
    let error: unknown;
    try {
      exchange().resolveElicitation(PENDING);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MissingClientCapabilityError);
    expect((error as MissingClientCapabilityError).requiredCapabilities).toEqual({ elicitation: { form: {} } });
  });

  it('still resolves a recorded answer without the capability declared', () => {
    const ex = exchange({ inputResponses: { 'elicitation-1': { action: 'accept', content: { confirmed: true } } } });
    expect(ex.resolveElicitation(PENDING)).toEqual({ status: 'accept', content: { confirmed: true } });
  });
});

describe('MrtrExchange — sampling', () => {
  it('raises a sampling/createMessage input request', () => {
    const signal = capture(() => exchange({ clientCapabilities: SAMPLING_CAPABLE }).resolveSampling(SAMPLE));

    expect(signal.inputRequests['sampling-1']).toMatchObject({
      method: 'sampling/createMessage',
      params: { maxTokens: 100 },
    });
  });

  it('returns the recorded completion on replay', () => {
    const answer = { role: 'assistant', content: { type: 'text', text: 'Paris' }, model: 'claude-x' };
    const ex = exchange({ clientCapabilities: SAMPLING_CAPABLE, inputResponses: { 'sampling-1': answer } });

    expect(ex.resolveSampling(SAMPLE)).toEqual(answer);
  });

  it('demands the sampling capability', () => {
    expect(() => exchange().resolveSampling(SAMPLE)).toThrow(MissingClientCapabilityError);
  });

  it('forwards includeContext "none" even without context support', () => {
    const signal = capture(() =>
      exchange({ clientCapabilities: SAMPLING_CAPABLE }).resolveSampling({ ...SAMPLE, includeContext: 'none' }),
    );
    expect(signal.inputRequests['sampling-1']?.params?.['includeContext']).toBe('none');
  });

  it('drops deprecated includeContext values when the client lacks context support', () => {
    // `thisServer` / `allServers` are deprecated; sending them to a client that
    // never declared `sampling.context` would ask for something unsupported.
    const signal = capture(() =>
      exchange({ clientCapabilities: SAMPLING_CAPABLE }).resolveSampling({ ...SAMPLE, includeContext: 'thisServer' }),
    );
    expect(signal.inputRequests['sampling-1']?.params?.['includeContext']).toBeUndefined();
  });

  it('forwards deprecated includeContext values when context support is declared', () => {
    const signal = capture(() =>
      exchange({ clientCapabilities: { sampling: { context: {} } } }).resolveSampling({
        ...SAMPLE,
        includeContext: 'thisServer',
      }),
    );
    expect(signal.inputRequests['sampling-1']?.params?.['includeContext']).toBe('thisServer');
  });

  it('omits optional params that were not supplied', () => {
    const signal = capture(() => exchange({ clientCapabilities: SAMPLING_CAPABLE }).resolveSampling(SAMPLE));
    const params = signal.inputRequests['sampling-1']?.params ?? {};
    expect(params['systemPrompt']).toBeUndefined();
    expect(params['temperature']).toBeUndefined();
  });
});

describe('MrtrExchange — roots', () => {
  it('raises a roots/list input request', () => {
    const signal = capture(() => exchange({ clientCapabilities: ROOTS_CAPABLE }).resolveRoots());
    expect(signal.inputRequests['roots-1']).toMatchObject({ method: 'roots/list' });
  });

  it('returns the recorded roots on replay', () => {
    const ex = exchange({
      clientCapabilities: ROOTS_CAPABLE,
      inputResponses: { 'roots-1': { roots: [{ uri: 'file:///work', name: 'work' }] } },
    });

    expect(ex.resolveRoots()).toEqual({ roots: [{ uri: 'file:///work', name: 'work' }] });
  });

  it('normalizes a malformed roots answer to an empty list', () => {
    const ex = exchange({ clientCapabilities: ROOTS_CAPABLE, inputResponses: { 'roots-1': { roots: 'nope' } } });
    expect(ex.resolveRoots()).toEqual({ roots: [] });
  });

  it('demands the roots capability', () => {
    expect(() => exchange().resolveRoots()).toThrow(MissingClientCapabilityError);
  });
});

describe('MrtrExchange — mixed kinds', () => {
  it('keys each kind independently so counters never collide', () => {
    const ex = exchange({ clientCapabilities: { ...ELICITATION_CAPABLE, ...SAMPLING_CAPABLE } });

    const first = capture(() => ex.resolveElicitation(PENDING));
    expect(Object.keys(first.inputRequests)).toEqual(['elicitation-1']);

    const second = capture(() => ex.resolveSampling(SAMPLE));
    // The pending map accumulates across the run, so the retry is asked for both.
    expect(Object.keys(second.inputRequests).sort()).toEqual(['elicitation-1', 'sampling-1']);
  });
});

describe('buildInputRequiredResult', () => {
  it('produces the interim result envelope', () => {
    const signal = new InputRequiredSignal(
      { 'elicitation-1': { method: 'elicitation/create', params: {} } },
      'state-blob',
    );

    expect(buildInputRequiredResult(signal)).toEqual({
      resultType: 'input_required',
      inputRequests: { 'elicitation-1': { method: 'elicitation/create', params: {} } },
      requestState: 'state-blob',
    });
  });
});

describe('MrtrExchange — elicitation modes', () => {
  const URL_PENDING = { ...PENDING, mode: 'url' as const, url: 'https://example.com/approve' };

  it('treats a bare `elicitation: {}` as implicit form support', () => {
    const signal = capture(() => exchange({ clientCapabilities: { elicitation: {} } }).resolveElicitation(PENDING));
    expect(signal.inputRequests['elicitation-1']?.method).toBe('elicitation/create');
  });

  it('refuses url mode when the client declared only form', () => {
    // URL elicitation sends the user out of band, so it is never implicit — a
    // form-only client cannot service it.
    let error: unknown;
    try {
      exchange({ clientCapabilities: { elicitation: { form: {} } } }).resolveElicitation(URL_PENDING);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MissingClientCapabilityError);
    expect((error as MissingClientCapabilityError).requiredCapabilities).toEqual({ elicitation: { url: {} } });
  });

  it('allows url mode when the client declared it', () => {
    const signal = capture(() =>
      exchange({ clientCapabilities: { elicitation: { url: {} } } }).resolveElicitation(URL_PENDING),
    );
    expect(signal.inputRequests['elicitation-1']?.params?.['mode']).toBe('url');
  });

  it('refuses form mode when the client declared only url', () => {
    expect(() => exchange({ clientCapabilities: { elicitation: { url: {} } } }).resolveElicitation(PENDING)).toThrow(
      MissingClientCapabilityError,
    );
  });
});
