import { JobDynamicRecord } from '../../common/records/job.record';
import { JobEnclaveBridge } from './job-enclave.bridge';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

/**
 * Executor for DYNAMIC jobs that run scripts in the enclave sandbox.
 */
export class JobDynamicExecutor {
  private readonly bridge: JobEnclaveBridge;
  private readonly logger: FrontMcpLogger;

  constructor(logger: FrontMcpLogger) {
    this.logger = logger;
    this.bridge = new JobEnclaveBridge(logger);
  }

  async execute(
    record: JobDynamicRecord,
    input: unknown,
    context?: {
      callTool?: (name: string, args: unknown) => Promise<unknown>;
      getTool?: (name: string) => unknown;
      mcpLog?: (level: string, message: string) => void;
    },
  ): Promise<unknown> {
    this.logger.info(`Executing dynamic job "${record.metadata.name}" via enclave`);

    const result = await this.bridge.execute(record.script, input, context ?? {});
    return result;
  }
}
