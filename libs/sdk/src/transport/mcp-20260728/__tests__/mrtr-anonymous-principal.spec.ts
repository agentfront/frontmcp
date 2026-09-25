import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

interface ToolCallResult {
  resultType?: string;
  inputRequests?: Record<string, { params: { message: string } }>;
  requestState?: string;
  structuredContent?: Record<string, unknown>;
}

interface BookingOutcome {
  questionsAsked: string[];
  booking: Record<string, unknown> | null;
}

const ANSWERS: Record<string, Record<string, string>> = {
  'Which day?': { day: 'Monday' },
  'What time?': { time: '10:00' },
};

const MAX_ROUNDS = 4;

@Tool({ name: 'book_meeting', inputSchema: {} })
class BookMeetingTool extends ToolContext {
  async execute() {
    const day = await this.elicit('Which day?', z.object({ day: z.string() }));
    const time = await this.elicit('What time?', z.object({ time: z.string() }));
    return { day: day.content?.day, time: time.content?.time };
  }
}

@App({ id: 'calendar', name: 'Calendar', tools: [BookMeetingTool] })
class CalendarApp {}

async function bookAnsweringOnlyNewQuestions(server: TestFetchServer): Promise<BookingOutcome> {
  const questionsAsked: string[] = [];
  let retryParams: Record<string, unknown> = {};
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'book_meeting', arguments: {}, ...retryParams },
      { capabilities: { elicitation: { form: {} } } },
    );
    const result = message.result as ToolCallResult | undefined;
    if (result?.resultType !== 'input_required') {
      return { questionsAsked, booking: result?.structuredContent ?? null };
    }
    const [inputKey, inputRequest] = Object.entries(result.inputRequests ?? {})[0];
    const question = inputRequest.params.message;
    questionsAsked.push(question);
    retryParams = {
      inputResponses: { [inputKey]: { action: 'accept', content: ANSWERS[question] } },
      requestState: result.requestState,
    };
  }
  return { questionsAsked, booking: null };
}

describe('MRTR requestState for anonymous MCP 2026-07-28 callers', () => {
  it('completes a two-question elicitation on a public server when the client answers only the new question', async () => {
    const server = await createTestFetchServer({
      info: { name: 'mrtr-anonymous-public', version: '1.0.0' },
      apps: [CalendarApp],
      elicitation: { enabled: true },
    });

    const outcome = await bookAnsweringOnlyNewQuestions(server);

    expect(outcome).toEqual({
      questionsAsked: ['Which day?', 'What time?'],
      booking: { day: 'Monday', time: '10:00' },
    });
  });

  it('completes a two-question elicitation for an anonymous caller of a transparent-auth server that allows anonymous access', async () => {
    const issuer = await createTestJwtIssuer();
    const server = await createTestFetchServer({
      info: { name: 'mrtr-anonymous-transparent', version: '1.0.0' },
      apps: [CalendarApp],
      elicitation: { enabled: true },
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        allowAnonymous: true,
      },
    });

    const outcome = await bookAnsweringOnlyNewQuestions(server);

    expect(outcome).toEqual({
      questionsAsked: ['Which day?', 'What time?'],
      booking: { day: 'Monday', time: '10:00' },
    });
  });
});
