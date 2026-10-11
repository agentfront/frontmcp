import { fileExists, readFile } from '@frontmcp/utils';

import { c } from '../../core/colors';
import { exchangeGithubOidcToken, exchangeSignature, requestJson, type SignatureAuthMethod } from './api';
import { RegistryError } from './errors';
import { defaultKeyPath, parsePrivateKey, publicKeyBase64, registryTimestamp, signTimestamp } from './keys';
import { checkDnsProof, checkHttpProof } from './proof';
import { domainOfServerName, reverseDomain } from './server-json';

export type AuthMethod = SignatureAuthMethod | 'github-oidc';

export interface LoginOptions {
  registryUrl: string;
  serverName: string;
  auth: AuthMethod;
  domain?: string;
  keyFile?: string;
}

export async function logIn(options: LoginOptions): Promise<string> {
  if (options.auth === 'github-oidc') return logInWithGithubOidc(options.registryUrl, options.serverName);

  const domain = options.domain ?? domainOfServerName(options.serverName);
  assertNamespaceGranted(options.serverName, domain, options.auth);
  const privateKey = parsePrivateKey(await readPrivateKeyText(options.keyFile));
  const publicKey = publicKeyBase64(privateKey);

  if (options.auth === 'http') {
    const problem = await checkHttpProof(domain, publicKey);
    if (problem) throw new RegistryError(`The HTTP proof is not ready: ${problem}`);
  } else {
    const problem = await checkDnsProof(domain, publicKey);
    if (problem) {
      console.error(c('yellow', `DNS proof: ${problem} Trying anyway, since the Registry resolves DNS itself.`));
    }
  }

  const timestamp = registryTimestamp();
  console.error(c('gray', `Logging in to ${options.registryUrl} with the ${options.auth} proof of ${domain}...`));
  return exchangeSignature(options.registryUrl, options.auth, {
    domain,
    timestamp,
    signedTimestamp: signTimestamp(privateKey, timestamp),
  });
}

function assertNamespaceGranted(serverName: string, domain: string, auth: SignatureAuthMethod): void {
  if (/(^|\.)github\.io$/i.test(domain)) {
    throw new RegistryError(
      'github.io domains cannot log in with http or dns: io.github.* names use --auth github-oidc.',
    );
  }
  const namespace = serverName.split('/')[0];
  const granted = reverseDomain(domain);
  if (namespace === granted || (auth === 'dns' && namespace.startsWith(`${granted}.`))) return;
  const proofGrants =
    auth === 'dns'
      ? `A DNS proof on ${domain} grants ${granted}/* and ${granted}.*/*`
      : `An HTTP proof on ${domain} grants ${granted}/* only`;
  throw new RegistryError(
    `${proofGrants}, not ${serverName}. ` +
      `Pass --domain ${domainOfServerName(serverName)}` +
      (auth === 'http' ? ', or use --auth dns on the parent domain to cover subdomains.' : '.'),
  );
}

async function readPrivateKeyText(keyFile: string | undefined): Promise<string> {
  if (keyFile) {
    if (!(await fileExists(keyFile))) throw new RegistryError(`Key file not found: ${keyFile}`);
    return readFile(keyFile);
  }
  const fromEnv = process.env['MCP_REGISTRY_PRIVATE_KEY'];
  if (fromEnv) return fromEnv;
  const keygenFile = defaultKeyPath();
  if (await fileExists(keygenFile)) return readFile(keygenFile);
  throw new RegistryError(
    `No private key: pass --key-file <path>, set MCP_REGISTRY_PRIVATE_KEY, or create ${keygenFile} ` +
      'with frontmcp registry keygen.',
  );
}

async function logInWithGithubOidc(registryUrl: string, serverName: string): Promise<string> {
  if (!serverName.startsWith('io.github.')) {
    throw new RegistryError(
      `GitHub OIDC grants io.github.<owner>/* only, not ${serverName}. Use --auth http or --auth dns for a domain namespace.`,
    );
  }
  const requestUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!requestUrl || !requestToken) {
    throw new RegistryError(
      '--auth github-oidc works only in GitHub Actions, in a job with "permissions: id-token: write".',
    );
  }
  const tokenUrl = new URL(requestUrl);
  tokenUrl.searchParams.set('audience', new URL(registryUrl).origin);
  const { status, body } = await requestJson(tokenUrl.toString(), {
    headers: { authorization: `Bearer ${requestToken}`, accept: 'application/json' },
  });
  const oidcToken = body && typeof body === 'object' ? (body as { value?: unknown }).value : undefined;
  if (status !== 200 || typeof oidcToken !== 'string') {
    throw new RegistryError(`GitHub Actions did not issue an ID token (HTTP ${status}).`);
  }
  console.error(c('gray', `Logging in to ${registryUrl} with GitHub OIDC...`));
  return exchangeGithubOidcToken(registryUrl, oidcToken);
}
