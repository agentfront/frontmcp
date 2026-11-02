import {
  FrontMcpInstance,
  InvalidSharedServerOptionsError,
  SharedServerIdentityError,
  SharedServerStartError,
  UnsafeSharedServerDirectoryError,
  type SharedIdentifyFlow,
  type SharedServerOptions,
  type SharedServerTransport,
} from '@frontmcp/sdk';

const serverConfig = { info: { name: 'shared', version: '1.0.0' }, apps: [] };

const transport: SharedServerTransport = 'http';
const options: SharedServerOptions = { key: 'my-server', transport };

export async function runSharedSession(): Promise<void> {
  await FrontMcpInstance.runShared(serverConfig, { key: 'my-server' });
  await FrontMcpInstance.runShared(serverConfig, options);
}

export function sharedServerErrorCode(error: unknown): string | undefined {
  if (error instanceof InvalidSharedServerOptionsError) return error.code;
  if (error instanceof UnsafeSharedServerDirectoryError) return error.code;
  if (error instanceof SharedServerStartError) return error.code;
  if (error instanceof SharedServerIdentityError) return error.code;
  return undefined;
}

export type IdentifyFlow = SharedIdentifyFlow;

export class InvalidSharedServerOptions {
  // @ts-expect-error transport is 'unix' or 'http'
  static readonly transport: SharedServerOptions = { key: 'my-server', transport: 'tcp' };
  // @ts-expect-error key is required
  static readonly key: SharedServerOptions = { transport: 'unix' };
}
