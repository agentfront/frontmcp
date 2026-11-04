import { PassThrough } from 'stream';

import { generateTerminalElicitationSource } from '../terminal-elicitation';

interface ElicitationRequest {
  message: string;
  requestedSchema: { type: 'object'; properties: Record<string, { type: string; title?: string }> };
}

interface ElicitationAnswer {
  action: string;
  content?: Record<string, unknown>;
}

interface TerminalElicitationModule {
  createElicitationHandler(options: {
    assumeYes: () => boolean;
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
  }): (request: ElicitationRequest) => Promise<ElicitationAnswer>;
}

const CONFIRMATION: ElicitationRequest = {
  message: 'Run voidInvoice: Void an invoice. (DELETE /invoices/{id}) with {"id":"inv_1"}?',
  requestedSchema: { type: 'object', properties: { confirmed: { type: 'boolean' } } },
};

const FORM: ElicitationRequest = {
  message: 'Who is this for?',
  requestedSchema: {
    type: 'object',
    properties: { name: { type: 'string', title: 'Name' }, seats: { type: 'integer' }, notify: { type: 'boolean' } },
  },
};

function loadTerminalElicitation(): TerminalElicitationModule {
  const loadedModule = { exports: {} as TerminalElicitationModule };
  new Function('require', 'exports', 'module', generateTerminalElicitationSource())(
    require,
    loadedModule.exports,
    loadedModule,
  );
  return loadedModule.exports;
}

/** A terminal: answers typed one line at a time, and what the handler printed. */
function terminal(options: { isTTY: boolean; assumeYes?: boolean; lines?: string[] }) {
  const input = Object.assign(new PassThrough(), { isTTY: options.isTTY });
  const output = new PassThrough();
  let printed = '';
  const lines = [...(options.lines ?? [])];
  output.on('data', (chunk: Buffer) => {
    printed += chunk.toString();
    const nextLine = lines.shift();
    if (nextLine !== undefined) input.write(`${nextLine}\n`);
  });
  const answer = loadTerminalElicitation().createElicitationHandler({
    assumeYes: () => options.assumeYes ?? false,
    input,
    output,
  });
  return { answer, printed: () => printed };
}

describe('generateTerminalElicitationSource', () => {
  it('accepts a yes/no question without asking when --yes is set', async () => {
    const { answer, printed } = terminal({ isTTY: false, assumeYes: true });

    await expect(answer(CONFIRMATION)).resolves.toEqual({ action: 'accept', content: { confirmed: true } });
    expect(printed()).toBe('');
  });

  it('declines with the question and how to confirm when there is no terminal to ask on', async () => {
    const { answer, printed } = terminal({ isTTY: false });

    await expect(answer(CONFIRMATION)).resolves.toEqual({ action: 'decline' });
    expect(printed()).toBe(
      `${CONFIRMATION.message}\nDeclined: there is no terminal to ask on. Run the command again with --yes to confirm.\n`,
    );
  });

  it('asks a yes/no question in the terminal and accepts a yes', async () => {
    const { answer, printed } = terminal({ isTTY: true, lines: ['y'] });

    await expect(answer(CONFIRMATION)).resolves.toEqual({ action: 'accept', content: { confirmed: true } });
    expect(printed()).toContain(`${CONFIRMATION.message} [y/N] `);
  });

  it.each(['n', '', 'maybe'])('declines a yes/no question answered %j', async (line) => {
    const { answer } = terminal({ isTTY: true, lines: [line] });

    await expect(answer(CONFIRMATION)).resolves.toEqual({ action: 'decline' });
  });

  it('asks each field of another question in the terminal, which --yes does not answer', async () => {
    const { answer, printed } = terminal({ isTTY: true, assumeYes: true, lines: ['Ada', '3', 'yes'] });

    await expect(answer(FORM)).resolves.toEqual({ action: 'accept', content: { name: 'Ada', seats: 3, notify: true } });
    expect(printed()).toContain('Who is this for?\n');
    expect(printed()).toContain('  Name: ');
  });

  it('leaves out a field answered with nothing', async () => {
    const { answer } = terminal({ isTTY: true, lines: ['Ada', '', ''] });

    await expect(answer(FORM)).resolves.toEqual({ action: 'accept', content: { name: 'Ada' } });
  });

  it('declines another question without a terminal, even with --yes', async () => {
    const { answer, printed } = terminal({ isTTY: false, assumeYes: true });

    await expect(answer(FORM)).resolves.toEqual({ action: 'decline' });
    expect(printed()).toBe('Who is this for?\nDeclined: there is no terminal to ask on.\n');
  });
});
