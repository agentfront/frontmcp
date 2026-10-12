import * as path from 'path';

import { fileExists, readFile } from '@frontmcp/utils';

import { c } from '../../core/colors';
import { listingUrl, publishServer, validateOnRegistry } from './api';
import { RegistryError } from './errors';
import { logIn, type AuthMethod } from './login';
import {
  loadDecoratorConfig,
  loadRegistryProject,
  readPackageJson,
  resolveRegistryUrl,
  type RegistryProject,
} from './project';
import { buildServerJson, type ServerJson } from './server-json';
import { npmMcpNameIssues, validateServerJson, type ValidationIssue } from './validate';

export interface PublishOptions {
  auth: AuthMethod;
  domain?: string;
  keyFile?: string;
  file?: string;
  url?: string;
  registry?: string;
  entry?: string;
  dryRun?: boolean;
  configPath?: string;
}

interface ResolvedServerJson {
  serverJson: unknown;
  issues: ValidationIssue[];
}

export async function publishToRegistry(options: PublishOptions): Promise<void> {
  const cwd = process.cwd();
  const project = await loadRegistryProject(cwd, options.configPath);
  const registryUrl = resolveRegistryUrl(options.registry, project);
  const { serverJson, issues } = options.file
    ? await readServerJsonFile(path.resolve(cwd, options.file))
    : await buildProjectServerJson(project, options, cwd);

  if (options.dryRun) console.log(JSON.stringify(serverJson, null, 2));
  if (issues.length > 0) {
    throw new RegistryError(`server.json is not valid:\n${issues.map(formatIssue).join('\n')}`);
  }
  console.error(c('green', 'server.json passes the local checks.'));

  const remote = await validateOnRegistry(registryUrl, serverJson);
  const remoteReport = remote.messages.map((message) => `  ${message}`).join('\n');
  if (!remote.valid) throw new RegistryError(`${registryUrl}/v0.1/validate rejected server.json:\n${remoteReport}`);
  console.error(
    c('green', `${registryUrl}/v0.1/validate accepts server.json.`) + (remoteReport && `\n${remoteReport}`),
  );

  const { name, version } = serverJson as ServerJson;
  if (options.dryRun) {
    console.error(`Dry run: ${name}@${version} was not published. Run without --dry-run to log in and publish it.`);
    return;
  }

  const token = await logIn({
    registryUrl,
    serverName: name,
    auth: options.auth,
    domain: options.domain,
    keyFile: options.keyFile && path.resolve(cwd, options.keyFile),
  });
  const published = await publishServer(registryUrl, token, serverJson as ServerJson);
  const latest = published.isLatest === undefined ? '' : ` (isLatest: ${published.isLatest})`;
  console.log(c('green', `Published ${published.name}@${published.version} to ${registryUrl}${latest}.`));
  console.log(`See the listing: ${listingUrl(registryUrl, published.name)}`);
}

async function buildProjectServerJson(
  project: RegistryProject,
  options: PublishOptions,
  cwd: string,
): Promise<ResolvedServerJson> {
  const entry = options.entry ? path.resolve(cwd, options.entry) : project.entry;
  const [decoratorConfig, packageJson] = await Promise.all([
    loadDecoratorConfig(project.projectDir, entry),
    readPackageJson(project.projectDir),
  ]);
  const { serverJson, warnings } = buildServerJson({
    decoratorConfig,
    packageJson,
    remoteUrl: options.url ?? project.registry.url,
    packages: project.registry.packages,
  });
  for (const warning of warnings) console.error(c('yellow', warning));
  return { serverJson, issues: [...validateServerJson(serverJson), ...npmMcpNameIssues(serverJson, packageJson)] };
}

async function readServerJsonFile(filePath: string): Promise<ResolvedServerJson> {
  if (!(await fileExists(filePath))) throw new RegistryError(`File not found: ${filePath}`);
  let serverJson: unknown;
  try {
    serverJson = JSON.parse(await readFile(filePath));
  } catch (error) {
    throw new RegistryError(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
  return { serverJson, issues: validateServerJson(serverJson) };
}

function formatIssue(issue: ValidationIssue): string {
  return `  ${issue.path || '(top level)'}: ${issue.message}`;
}
