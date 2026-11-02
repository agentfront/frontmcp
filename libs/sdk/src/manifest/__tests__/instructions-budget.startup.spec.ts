import 'reflect-metadata';

import { App, LogLevel, LogTransport, LogTransportInterface, Tool, ToolContext, type LogRecord } from '../../common';
import { FrontMcp } from '../../common/decorators/front-mcp.decorator';
import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const warnings: string[] = [];

@LogTransport({ name: 'BudgetCaptureLogger', description: 'Captures warnings for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Tool({ name: 'wordy', description: 'w'.repeat(30), inputSchema: {} })
class WordyTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'tucked_away', description: 't'.repeat(30), inputSchema: {}, visibility: 'hidden' })
class TuckedAwayTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ id: 'budget', name: 'Budget', tools: [WordyTool, TuckedAwayTool] })
class BudgetApp {}

async function startWith(instructionsBudget: unknown): Promise<string[]> {
  warnings.length = 0;
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'budget-demo', version: '1.0.0' },
    apps: [BudgetApp],
    instructions: 'i'.repeat(50),
    instructionsBudget: instructionsBudget as false,
    logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
  });
  await server.dispose();
  return warnings.filter((message) => message.includes('instructionsBudget'));
}

describe('instructionsBudget at startup', () => {
  it('warns about the instructions and each listed tool description over the budget', async () => {
    expect(await startWith({ instructions: 40, toolDescription: 20 })).toEqual([
      expect.stringContaining('The initialize instructions are 50 characters, over the instructionsBudget of 40'),
      'Tool "wordy" has a 30-character description, over the instructionsBudget.toolDescription of 20.',
    ]);
  });

  it('stays quiet within the default budget, and when the budget is off', async () => {
    expect(await startWith(undefined)).toEqual([]);
    expect(await startWith(false)).toEqual([]);
  });

  it('refuses an invalid budget at boot', () => {
    expect(() =>
      FrontMcp({
        info: { name: 'bad-budget', version: '1.0.0' },
        apps: [BudgetApp],
        instructionsBudget: { instructions: -1 },
      })(class BadBudgetServer {}),
    ).toThrow(InvalidDecoratorMetadataError);
    expect(() =>
      FrontMcp({
        info: { name: 'bad-budget', version: '1.0.0' },
        apps: [BudgetApp],
        instructionsBudget: { toolDescriptions: 10 } as never,
      })(class TypoBudgetServer {}),
    ).toThrow(/instructionsBudget/);
  });
});
