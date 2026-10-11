import * as path from 'path';

import { c } from '../../core/colors';
import { updateServerStatus, type ServerStatus } from './api';
import { RegistryError } from './errors';
import { logIn, type AuthMethod } from './login';
import { loadDecoratorConfig, loadRegistryProject, resolveRegistryUrl } from './project';
import { registryServerName } from './server-json';

const MAX_STATUS_MESSAGE_LENGTH = 500;

export interface StatusOptions {
  status: ServerStatus;
  serverVersion?: string;
  allVersions?: boolean;
  message?: string;
  name?: string;
  auth: AuthMethod;
  domain?: string;
  keyFile?: string;
  registry?: string;
  entry?: string;
  configPath?: string;
}

export async function setServerStatus(options: StatusOptions): Promise<void> {
  if (options.serverVersion && options.allVersions) {
    throw new RegistryError('Pass --server-version <version> or --all-versions, not both.');
  }
  if (!options.serverVersion && !options.allVersions) {
    throw new RegistryError(
      'Pass --server-version <version> to change one version, or --all-versions to change every version.',
    );
  }
  if (options.message && options.status === 'active') {
    throw new RegistryError('--message goes with deprecated or deleted: the Registry clears the message on active.');
  }
  if (options.message && options.message.length > MAX_STATUS_MESSAGE_LENGTH) {
    throw new RegistryError(`--message must be at most ${MAX_STATUS_MESSAGE_LENGTH} characters.`);
  }
  const cwd = process.cwd();
  const project = await loadRegistryProject(cwd, options.configPath);
  const registryUrl = resolveRegistryUrl(options.registry, project);
  const entry = options.entry ? path.resolve(cwd, options.entry) : project.entry;
  const name = options.name ?? registryServerName(await loadDecoratorConfig(project.projectDir, entry));

  const token = await logIn({
    registryUrl,
    serverName: name,
    auth: options.auth,
    domain: options.domain,
    keyFile: options.keyFile && path.resolve(cwd, options.keyFile),
  });
  const changed = await updateServerStatus(registryUrl, token, {
    name,
    version: options.serverVersion,
    status: options.status,
    message: options.message,
  });
  const target = options.serverVersion ? `${name}@${options.serverVersion} is` : `${changed} version(s) of ${name} are`;
  console.log(c('green', `${target} now ${options.status}.`));
}
