import { decisionsApiDecider, NO_SKILL_CHOICE } from '../decision';

const candidates = [
  { id: 'pet-catalog', name: 'Pet catalog', description: 'Find dogs, cats and birds.', tags: ['puppies'] },
  { id: 'store', name: 'Store', description: 'Count the pets in stock, and read an order.' },
];

const answer = (probabilities: Array<[string | boolean, number]>) => ({
  answers: [
    {
      type: 'choice',
      name: 'skill',
      choice: probabilities[0][0],
      confidence: probabilities[0][1],
      probabilities: probabilities.map(([value, probability]) => ({ value, probability })),
    },
  ],
});

function fakeFetch(status: number, body: unknown) {
  return jest.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('decisionsApiDecider (#1062)', () => {
  it('asks one choice question among the candidates and "none", with the catalog as the cacheable input', async () => {
    const fetchMock = fakeFetch(
      200,
      answer([
        ['pet-catalog', 0.9],
        ['store', 0.04],
        [NO_SKILL_CHOICE, 0.06],
      ]),
    );
    const decide = decisionsApiDecider({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch });
    const signal = new AbortController().signal;

    const decisions = await decide({ query: 'kittens', notQuery: ['stock'], candidates, signal });

    expect(decisions).toEqual([
      { id: 'pet-catalog', probability: 0.9 },
      { id: 'store', probability: 0.04 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input).toContain('- pet-catalog: Pet catalog: Find dogs, cats and birds. [puppies]');
    expect(body.input).toContain('- store: Store: Count the pets in stock, and read an order.');
    expect(body.prompt_cache_key).toMatch(/^skills-[0-9a-f]{32}$/);
    expect(body.questions).toEqual([
      {
        type: 'choice',
        name: 'skill',
        instructions: 'Which skill best handles this request: "kittens"? The user does not want: stock.',
        choices: [
          { value: 'pet-catalog', description: 'Pet catalog' },
          { value: 'store', description: 'Store' },
          { value: NO_SKILL_CHOICE, description: 'None of these skills fits the request.' },
        ],
      },
    ]);
  });

  it('keeps the same cache key for the same catalog, whatever the query', async () => {
    const fetchMock = fakeFetch(200, answer([['store', 0.8]]));
    const decide = decisionsApiDecider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const signal = new AbortController().signal;

    await decide({ query: 'order', notQuery: [], candidates, signal });
    await decide({ query: 'inventory', notQuery: [], candidates, signal });

    const keys = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).prompt_cache_key,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('calls another base URL and model, such as a gateway serving Jev', async () => {
    const fetchMock = fakeFetch(200, answer([['store', 0.7]]));
    const decide = decisionsApiDecider({
      apiKey: 'k',
      baseUrl: 'https://api.llmgateway.io/v1/',
      model: 'jev-1.13.0',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await decide({ query: 'order', notQuery: [], candidates, signal: new AbortController().signal });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.llmgateway.io/v1/decisions');
    expect(JSON.parse(init.body as string).model).toBe('jev-1.13.0');
  });

  it('leaves out answers for values that are not candidates', async () => {
    const fetchMock = fakeFetch(
      200,
      answer([
        ['store', 0.5],
        ['invented', 0.3],
        [true, 0.2],
      ]),
    );
    const decide = decisionsApiDecider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });

    expect(await decide({ query: 'q', notQuery: [], candidates, signal: new AbortController().signal })).toEqual([
      { id: 'store', probability: 0.5 },
    ]);
  });

  it('makes no call without candidates', async () => {
    const fetchMock = jest.fn();
    const decide = decisionsApiDecider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });

    expect(await decide({ query: 'q', notQuery: [], candidates: [], signal: new AbortController().signal })).toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on an HTTP error and on a refusal, never naming the API key', async () => {
    const signal = new AbortController().signal;
    const failing = decisionsApiDecider({ apiKey: 'secret-key', fetch: fakeFetch(429, {}) as unknown as typeof fetch });
    await expect(failing({ query: 'q', notQuery: [], candidates, signal })).rejects.toThrow(
      'the Decisions API answered 429',
    );

    const refusing = decisionsApiDecider({
      apiKey: 'secret-key',
      fetch: fakeFetch(200, { answers: [{ type: 'refusal', name: 'skill' }] }) as unknown as typeof fetch,
    });
    await expect(refusing({ query: 'q', notQuery: [], candidates, signal })).rejects.toThrow(
      'the Decisions API answered with no choice (refusal)',
    );
    await expect(refusing({ query: 'q', notQuery: [], candidates, signal })).rejects.not.toThrow('secret-key');
  });
});
