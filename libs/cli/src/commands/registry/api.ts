import { RegistryError } from './errors';

const REQUEST_TIMEOUT_MS = 30_000;
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, application/problem+json' };

export type SignatureAuthMethod = 'http' | 'dns';
export type ServerStatus = 'active' | 'deprecated' | 'deleted';

export interface JsonResponse {
  status: number;
  body: unknown;
}

export interface RemoteValidation {
  valid: boolean;
  messages: string[];
}

export interface PublishedServer {
  name: string;
  version: string;
  status?: string;
  isLatest?: boolean;
}

export interface StatusChange {
  name: string;
  version?: string;
  status: ServerStatus;
  message?: string;
}

export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await read(await fetch(url, { ...init, signal: controller.signal }));
  } catch (error) {
    const reason = controller.signal.aborted
      ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s`
      : fetchErrorMessage(error);
    throw new RegistryError(`${init.method ?? 'GET'} ${url} failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestJson(url: string, init: RequestInit): Promise<JsonResponse> {
  const response = await fetchWithTimeout(url, { ...init, redirect: 'manual' }, async (answer) => ({
    status: answer.status,
    location: answer.headers.get('location'),
    body: parseJson(await answer.text()),
  }));
  if (response.status >= 300 && response.status < 400) {
    throw new RegistryError(
      `${init.method ?? 'GET'} ${url} was redirected (${response.status}) to ${response.location ?? 'an unnamed location'}. ` +
        'The CLI never follows redirects on these requests, so nothing was sent there; ' +
        'if that is the registry you mean, pass its URL with --registry.',
    );
  }
  return { status: response.status, body: response.body };
}

export async function validateOnRegistry(registryUrl: string, serverJson: unknown): Promise<RemoteValidation> {
  const { status, body } = await requestJson(`${registryUrl}/v0.1/validate`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(serverJson),
  });
  if (status === 200 && isRecord(body) && typeof body['valid'] === 'boolean') {
    const issues = Array.isArray(body['issues']) ? body['issues'] : [];
    return { valid: body['valid'], messages: issues.map(formatValidationIssue) };
  }
  return { valid: false, messages: [describeProblem(status, body)] };
}

export async function exchangeSignature(
  registryUrl: string,
  method: SignatureAuthMethod,
  login: { domain: string; timestamp: string; signedTimestamp: string },
): Promise<string> {
  return exchangeToken(registryUrl, method, {
    domain: login.domain,
    timestamp: login.timestamp,
    signed_timestamp: login.signedTimestamp,
  });
}

export async function exchangeGithubOidcToken(registryUrl: string, oidcToken: string): Promise<string> {
  return exchangeToken(registryUrl, 'github-oidc', { oidc_token: oidcToken });
}

export async function publishServer(
  registryUrl: string,
  token: string,
  serverJson: { name: string; version: string },
): Promise<PublishedServer> {
  const { status, body } = await requestJson(`${registryUrl}/v0.1/publish`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify(serverJson),
  });
  if (status !== 200) throw new RegistryError(explainFailure('Publish', status, body, serverJson.name));
  const server = isRecord(body) && isRecord(body['server']) ? body['server'] : {};
  const meta = isRecord(body) && isRecord(body['_meta']) ? body['_meta'] : {};
  const official = meta['io.modelcontextprotocol.registry/official'];
  const officialMeta = isRecord(official) ? official : {};
  return {
    name: typeof server['name'] === 'string' ? server['name'] : serverJson.name,
    version: typeof server['version'] === 'string' ? server['version'] : serverJson.version,
    ...(typeof officialMeta['status'] === 'string' && { status: officialMeta['status'] }),
    ...(typeof officialMeta['isLatest'] === 'boolean' && { isLatest: officialMeta['isLatest'] }),
  };
}

/** PATCH one version's status, or every version's when `version` is unset. Returns how many versions changed. */
export async function updateServerStatus(registryUrl: string, token: string, change: StatusChange): Promise<number> {
  const versionPath = change.version ? `/versions/${encodeURIComponent(change.version)}` : '';
  const { status, body } = await requestJson(
    `${registryUrl}/v0.1/servers/${encodeURIComponent(change.name)}${versionPath}/status`,
    {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: change.status, ...(change.message && { statusMessage: change.message }) }),
    },
  );
  if (status !== 200) throw new RegistryError(explainFailure('Status change', status, body, change.name));
  if (change.version) return 1;
  return isRecord(body) && typeof body['updatedCount'] === 'number' ? body['updatedCount'] : 0;
}

export function listingUrl(registryUrl: string, serverName: string): string {
  return `${registryUrl}/v0.1/servers?search=${encodeURIComponent(serverName)}`;
}

async function exchangeToken(registryUrl: string, method: string, payload: Record<string, string>): Promise<string> {
  const { status, body } = await requestJson(`${registryUrl}/v0.1/auth/${method}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (status === 200 && isRecord(body) && typeof body['registry_token'] === 'string') return body['registry_token'];
  throw new RegistryError(`Login (${method}) failed: ${describeProblem(status, body)}`);
}

function explainFailure(action: string, status: number, body: unknown, serverName: string): string {
  const text = problemText(body).toLowerCase();
  let hint: string | undefined;
  if (status === 401) {
    hint =
      'The registry token is missing, invalid or expired (it lasts 5 minutes). Run the command again to log in again.';
  } else if (status === 403) {
    hint =
      `This login does not cover ${serverName}. An HTTP proof on example.com grants com.example/* only; ` +
      'a DNS proof on example.com also grants com.example.*/*; GitHub OIDC grants io.github.<owner>/* only. ' +
      'Log in for the domain that matches the namespace (--domain, --auth dns), or rename the server.';
  } else if (text.includes('duplicate version')) {
    hint =
      'Each name@version publishes once, even after it is deleted. Bump the version ' +
      '(info.version in @FrontMcp(), or version in package.json) and publish again.';
  } else if (text.includes('mcpname')) {
    hint =
      `The Registry reads "mcpName" from the published npm package: add "mcpName": "${serverName}" to ` +
      'package.json, publish that version to npm, and publish here again.';
  } else if (text.includes('already used by server')) {
    hint = 'Another server name already lists this remote URL. Publish under that name, or use a different URL.';
  } else if (status === 422) {
    hint = 'The Registry rejected server.json. Run frontmcp registry publish --dry-run to see its validation issues.';
  }
  return `${action} failed: ${describeProblem(status, body)}${hint ? `\n${hint}` : ''}`;
}

function describeProblem(status: number, body: unknown): string {
  if (!isRecord(body)) {
    const text = typeof body === 'string' ? body.trim().slice(0, 500) : '';
    return text ? `HTTP ${status}: ${text}` : `HTTP ${status}`;
  }
  const title = typeof body['title'] === 'string' ? body['title'] : `HTTP ${status}`;
  const detail = typeof body['detail'] === 'string' ? `: ${body['detail']}` : '';
  const errors = Array.isArray(body['errors']) ? body['errors'].filter(isRecord) : [];
  const errorLines = errors.map((error) => {
    const location = typeof error['location'] === 'string' ? `${error['location']}: ` : '';
    return `\n  - ${location}${String(error['message'] ?? '')}`;
  });
  return `${status} ${title}${detail}${errorLines.join('')}`;
}

function problemText(body: unknown): string {
  if (!isRecord(body)) return typeof body === 'string' ? body : '';
  const errors = Array.isArray(body['errors']) ? body['errors'].filter(isRecord) : [];
  return [body['detail'], ...errors.map((error) => error['message'])]
    .filter((part) => typeof part === 'string')
    .join(' ');
}

function formatValidationIssue(issue: unknown): string {
  if (!isRecord(issue)) return String(issue);
  const severity = typeof issue['severity'] === 'string' ? `[${issue['severity']}] ` : '';
  const path = typeof issue['path'] === 'string' && issue['path'] ? `${issue['path']}: ` : '';
  return `${severity}${path}${String(issue['message'] ?? '')}`;
}

function fetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error.message}${cause}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
