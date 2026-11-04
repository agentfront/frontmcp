/**
 * A scratch project whose server serves a Skilled OpenAPI bundle from a JSON file, built with
 * `frontmcp build --target cli`. The plugin registers the bundle's skills at runtime, after the server starts.
 */
import * as path from 'node:path';

import { writeFile } from '@frontmcp/utils';

import { createScratchProject } from './dev-cli';
import { runFrontmcpCliAsync } from './exec-cli';

const BUILD_TIMEOUT_MS = 150_000;

const getInvoice = {
  operationId: 'getInvoice',
  serviceId: 'billing',
  httpMethod: 'GET',
  pathTemplate: '/invoices/{id}',
  summary: 'Get an invoice by id.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  outputSchema: { type: 'object' },
  mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
  authBindingRef: 'none',
};

/** A DELETE action, which the server's `confirm` option makes ask the user first. */
const voidInvoice = {
  ...getInvoice,
  operationId: 'voidInvoice',
  httpMethod: 'DELETE',
  summary: 'Void an invoice.',
  outputSchema: {},
};

/** Two skills: `Invoices` for everyone, `Admin` only for callers with the `admin` role. */
export const SKILLED_BUNDLE = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://billing.example.test/v1' }],
  authBindings: { none: { kind: 'none' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up invoices.',
      instructions: '# Invoices\n\nFind an invoice by its id.',
      operationIds: ['getInvoice', 'voidInvoice'],
    },
    {
      id: 'admin',
      name: 'Admin',
      description: 'Billing administration.',
      instructions: '# Admin',
      operationIds: ['getInvoice'],
      requiredAuthorities: { roles: { any: ['admin'] } },
    },
  ],
  operations: { getInvoice, voidInvoice },
};

export interface SkilledCliProject {
  dir: string;
  /** The bundle file the plugin's static source reads. */
  bundlePath: string;
  /** The generated CLI, run with `runCliBundle()`. */
  cliBundle: string;
}

/**
 * Write and build the project.
 *
 * @param options.serverConfig - Extra `@FrontMcp()` fields, as TypeScript source (such as an `auth` block)
 * @param options.cli - The cli deployment's `cli` block
 * @param options.serviceBaseUrl - The base URL of a plain-HTTP API on loopback the bundle's service points to
 */
export async function buildSkilledCliProject(options: {
  prefix: string;
  appName: string;
  serverConfig?: string;
  cli?: Record<string, unknown>;
  serviceBaseUrl?: string;
}): Promise<SkilledCliProject> {
  const bundle = options.serviceBaseUrl
    ? { ...SKILLED_BUNDLE, services: [{ id: 'billing', baseUrl: options.serviceBaseUrl }] }
    : SKILLED_BUNDLE;
  const dir = await createScratchProject(options.prefix, {
    'bundle.json': JSON.stringify(bundle),
    'src/main.ts': '',
    'frontmcp.config.js': `module.exports = {
  name: '${options.appName}',
  version: '1.0.0',
  entry: './src/main.ts',
  build: { esbuild: { external: ['zod'] } },
  deployments: [{ target: 'cli', cli: ${JSON.stringify(options.cli ?? {})} }],
};\n`,
    // A project's own tsconfig, as a user's: the monorepo's paths would inline a second copy of the SDK
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'commonjs',
        moduleResolution: 'node',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['src'],
    }),
  });
  const bundlePath = path.join(dir, 'bundle.json');
  await writeFile(
    path.join(dir, 'src', 'main.ts'),
    serverSource(bundlePath, options.serverConfig ?? "auth: { mode: 'public' },", options.serviceBaseUrl !== undefined),
  );

  const build = await runFrontmcpCliAsync(['build', '--target', 'cli', '--js'], dir, BUILD_TIMEOUT_MS);
  if (build.exitCode !== 0) {
    throw new Error(`The ${options.appName} build failed:\n${build.stdout}${build.stderr}`);
  }
  return { dir, bundlePath, cliBundle: path.join(dir, 'dist', 'cli', `${options.appName}-cli.bundle.js`) };
}

function serverSource(bundlePath: string, serverConfig: string, loopbackService: boolean): string {
  const outbound = loopbackService ? '\n      outbound: { allowHttp: true, allowPrivateNetworks: true },' : '';
  return `import 'reflect-metadata';
import SkilledOpenApiPlugin from '@frontmcp/plugin-skilled-openapi';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'Billing CLI', version: '1.0.0' },
  apps: [],
  logging: { level: LogLevel.Warn, enableConsole: false },
  authorities: { claimsMapping: { roles: 'roles' } },
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static', path: ${JSON.stringify(bundlePath)}, watch: false },
      requireSignature: false,
      confirm: { methods: ['DELETE'] },${outbound}
    }),
  ],
  ${serverConfig}
})
export default class Server {}
`;
}
