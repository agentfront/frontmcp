import {
  BrowserEntryPointUnavailableError,
  FrontMcpInstance,
  InvalidSharedServerOptionsError,
  SharedServerIdentityError,
  SharedServerStartError,
  UnsafeSharedServerDirectoryError,
  type BrowserRefusedEntryPoint,
  type SharedDrainFlow,
  type SharedIdentifyFlow,
  type SharedServerOptions,
  type SharedServerTransport,
} from '@frontmcp/sdk';

const serverConfig = { info: { name: 'shared', version: '1.0.0' }, apps: [] };

const transport: SharedServerTransport = 'http';
const options: SharedServerOptions = { key: 'my-server', transport };
const upgrading: SharedServerOptions = {
  key: 'my-server',
  attachBudgetMs: 10_000,
  replaceOlder: false,
  idleTimeoutMs: false,
  checkout: '/work/my-server',
};
const kept: SharedServerOptions = { key: 'my-server', idleTimeoutMs: 60_000, checkout: false };

export async function runSharedSession(): Promise<void> {
  await FrontMcpInstance.runShared(serverConfig, { key: 'my-server' });
  await FrontMcpInstance.runShared(serverConfig, options);
  await FrontMcpInstance.runShared(serverConfig, upgrading);
  await FrontMcpInstance.runShared(serverConfig, kept);
}

export function sharedServerErrorCode(error: unknown): string | undefined {
  if (error instanceof InvalidSharedServerOptionsError) return error.code;
  if (error instanceof UnsafeSharedServerDirectoryError) return error.code;
  if (error instanceof SharedServerStartError) return error.code;
  if (error instanceof SharedServerIdentityError) return error.code;
  if (error instanceof BrowserEntryPointUnavailableError) return error.code;
  return undefined;
}

export function refusedEntryPoint(error: unknown): BrowserRefusedEntryPoint | undefined {
  return error instanceof BrowserEntryPointUnavailableError ? error.entryPoint : undefined;
}

export type IdentifyFlow = SharedIdentifyFlow;
export type DrainFlow = SharedDrainFlow;

export class InvalidSharedServerOptions {
  // @ts-expect-error transport is 'unix' or 'http'
  static readonly transport: SharedServerOptions = { key: 'my-server', transport: 'tcp' };
  // @ts-expect-error key is required
  static readonly key: SharedServerOptions = { transport: 'unix' };
  // @ts-expect-error replaceOlder is a boolean
  static readonly replaceOlder: SharedServerOptions = { key: 'my-server', replaceOlder: 'yes' };
  // @ts-expect-error idleTimeoutMs is a number or false
  static readonly idleTimeoutMs: SharedServerOptions = { key: 'my-server', idleTimeoutMs: true };
  // @ts-expect-error checkout is a folder or false
  static readonly checkout: SharedServerOptions = { key: 'my-server', checkout: true };
  // @ts-expect-error a browser refuses runShared and runUnixSocket only
  static readonly refusedEntryPoint: BrowserRefusedEntryPoint = 'runStdio';
}
