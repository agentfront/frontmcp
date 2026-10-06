/**
 * `logging.prefix` tags every record (#766), child loggers' included, ahead of the child's own name.
 */
import { LogLevel, type LogRecord, type LogTransportInterface } from '../../common';
import { LoggerInstance } from '../instances/instance.logger';

function loggerWith(prefix: string | undefined) {
  const records: LogRecord[] = [];
  const transport = { log: (rec: LogRecord) => records.push(rec) } as unknown as LogTransportInterface;
  const logger = new LoggerInstance({ level: LogLevel.Info, prefix } as never, () => ({ transports: [transport] }));
  return { logger, records };
}

describe('logging.prefix', () => {
  it("tags the root logger's records and every child's, ahead of the child's name", () => {
    const { logger, records } = loggerWith('billing-edge');

    logger.info('root');
    logger.child('SessionVerifyFlow').info('child');
    logger.child('Scope').child('ToolRegistry').info('grandchild');

    expect(records.map((rec) => rec.prefix)).toEqual([
      'billing-edge',
      'billing-edge:SessionVerifyFlow',
      'billing-edge:ToolRegistry',
    ]);
  });

  it('names a child by its own name alone without a logging.prefix', () => {
    const { logger, records } = loggerWith(undefined);

    logger.child('SessionVerifyFlow').info('child');

    expect(records[0].prefix).toBe('SessionVerifyFlow');
  });
});
