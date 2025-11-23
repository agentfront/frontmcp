// file: libs/plugins/src/codecall/providers/codecall-vm2.provider.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';
import { VM } from 'vm2';

import type { CodeCallExecuteInput } from '../codecall.types';
import { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import { CodeCallExecuteResult } from '../tools/execute.schema';

@Provider({
  name: 'codecall:vm2',
  description: 'vm2-based runner for CodeCall JavaScript plans',
  scope: ProviderScope.GLOBAL,
})
export default class CodeCallVm2Runner {
  constructor(private readonly vmOptions: ResolvedCodeCallVmOptions) {}

  async run(input: CodeCallExecuteInput, env: CodeCallVmEnvironment): Promise<CodeCallExecuteResult> {
    const logs: string[] = [];

    const sandbox: any = {
      callTool: env.callTool,
      getTool: env.getTool,
      codecallContext: Object.freeze({ ...(input.context ?? {}) }),
    };

    if (this.vmOptions.allowConsole) {
      // If caller passes a console, use it; otherwise capture logs.
      sandbox.console =
        env.console ??
        ({
          log: (...args: unknown[]) => logs.push(['log', ...args].map(String).join(' ')),
          warn: (...args: unknown[]) => logs.push(['warn', ...args].map(String).join(' ')),
          error: (...args: unknown[]) => logs.push(['error', ...args].map(String).join(' ')),
        } as unknown as Console);
    }

    if (env.mcpLog) sandbox.mcpLog = env.mcpLog;
    if (env.mcpNotify) sandbox.mcpNotify = env.mcpNotify;

    try {
      const vm = new VM({
        timeout: this.vmOptions.timeoutMs,
        sandbox,
        eval: false,
        wasm: false,
      });

      // NOTE:
      // Runtime hardening (e.g. vm.freeze(undefined, 'process')) is possible here,
      // but AST validation already rejects these. You can add extra freezes if desired.

      // The plan script is expected to be self-contained, e.g.:
      //   async function main() { ...; return result; }
      //   return main();
      const result = await vm.run(input.script);

      return {
        status: 'ok',
        result,
        logs: logs.length ? logs : undefined,
      };
    } catch (err: any) {
      // vm2 throws a special TimeoutError for timeouts
      if (err?.name === 'TimeoutError') {
        return {
          status: 'timeout',
          error: { message: err?.message ?? 'CodeCall script timed out.' },
        };
      }

      // For now treat everything else as script-level runtime error.
      return {
        status: 'runtime_error',
        error: {
          source: 'script',
          message: err?.message ?? String(err),
          name: err?.name,
          stack: err?.stack,
        },
      };
    }
  }
}
