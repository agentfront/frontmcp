import { z } from '@frontmcp/lazy-zod';

import type { PackageJsonFields, ServerJson } from './server-json';

export interface ValidationIssue {
  path: string;
  message: string;
}

const PUBLISHER_META_KEY = 'io.modelcontextprotocol.registry/publisher-provided';
const MAX_PUBLISHER_META_BYTES = 4096;
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\/[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
const REPOSITORY_URL_PATTERNS: Record<string, RegExp> = {
  github: /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?$/,
  gitlab: /^https?:\/\/(www\.)?gitlab\.com\/[\w.-]+\/[\w.-]+\/?$/,
};
const VERSION_RANGE_PATTERNS = [
  /^\s*(?:\^|~|>=|<=|>|<|=)\s*v?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?\s*$/,
  /^\s*v?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?\s-\s*v?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?\s*$/,
  /^\s*(?:v?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?\s*)(?:\|\|\s*v?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?\s*)+$/,
];
const WILDCARD_VERSION_PATTERN = /^\s*(?:v?\d+|x|X|\*)(?:\.(?:\d+|x|X|\*)){1,2}(?:-[0-9A-Za-z.-]+)?\s*$/;
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

const inputFields = {
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  format: z.enum(['string', 'number', 'boolean', 'filepath']).optional(),
  value: z.string().optional(),
  isSecret: z.boolean().optional(),
  default: z.string().optional(),
  placeholder: z.string().optional(),
  choices: z.array(z.string()).nullish(),
};
const inputSchema = z.object(inputFields).strict();
const variablesSchema = z.record(z.string(), inputSchema).optional();
const keyValueInputSchema = z.object({ ...inputFields, name: z.string(), variables: variablesSchema }).strict();
const argumentSchema = z
  .object({
    ...inputFields,
    type: z.string(),
    name: z.string().optional(),
    isRepeated: z.boolean().optional(),
    valueHint: z.string().optional(),
    variables: variablesSchema,
  })
  .strict();
const transportSchema = z
  .object({
    type: z.string(),
    url: z.string().optional(),
    headers: z.array(keyValueInputSchema).nullish(),
    variables: variablesSchema,
  })
  .strict();
const packageSchema = z
  .object({
    registryType: z.string().min(1),
    registryBaseUrl: z.string().optional(),
    identifier: z.string().min(1),
    version: z.string().min(1).max(255).optional(),
    fileSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    runtimeHint: z.string().optional(),
    transport: transportSchema,
    runtimeArguments: z.array(argumentSchema).nullish(),
    packageArguments: z.array(argumentSchema).nullish(),
    environmentVariables: z.array(keyValueInputSchema).nullish(),
  })
  .strict();
const iconSchema = z
  .object({
    src: z.string().max(255),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']).optional(),
    sizes: z.array(z.string()).nullish(),
    theme: z.enum(['light', 'dark']).optional(),
  })
  .strict();
const repositorySchema = z
  .object({
    url: z.string().optional(),
    source: z.string().optional(),
    subfolder: z.string().optional(),
    id: z.string().optional(),
  })
  .strict();
const serverJsonSchema = z
  .object({
    $schema: z.string().min(1),
    name: z
      .string()
      .min(3)
      .max(200)
      .regex(
        SERVER_NAME_PATTERN,
        'must be <reverse-dns namespace>/<name>, each part starting and ending with a letter or digit',
      ),
    description: z.string().min(1).max(100),
    version: z.string().min(1).max(255),
    title: z.string().min(1).max(100).optional(),
    websiteUrl: z.string().optional(),
    icons: z.array(iconSchema).nullish(),
    repository: repositorySchema.optional(),
    remotes: z.array(transportSchema).nullish(),
    packages: z.array(packageSchema).nullish(),
    _meta: z
      .object({ [PUBLISHER_META_KEY]: z.record(z.string(), z.unknown()).optional() })
      .strict()
      .optional(),
  })
  .strict();

type ParsedServerJson = z.infer<typeof serverJsonSchema>;

export function validateServerJson(serverJson: unknown): ValidationIssue[] {
  const parsed = serverJsonSchema.safeParse(serverJson);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
  }
  return semanticIssues(parsed.data);
}

export function npmMcpNameIssues(serverJson: ServerJson, packageJson: PackageJsonFields): ValidationIssue[] {
  const npmPackage = serverJson.packages?.find((entry) => entry.registryType === 'npm');
  if (!npmPackage || packageJson.mcpName === serverJson.name) return [];
  const found = packageJson.mcpName ? `has "mcpName": "${packageJson.mcpName}"` : 'has no mcpName';
  return [
    {
      path: 'packages[0]',
      message:
        `package.json ${found}. The Registry requires "mcpName": "${serverJson.name}" in the published ` +
        `${npmPackage.identifier}@${npmPackage.version}: add it to package.json, publish that version to npm, then publish here.`,
    },
  ];
}

function semanticIssues(server: ParsedServerJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  addVersionIssue('version', server.version, add);
  if (server.title !== undefined && !server.title.trim()) add('title', 'must not be only whitespace');
  if (server.websiteUrl !== undefined) {
    addHttpsUrlIssue('websiteUrl', server.websiteUrl, add);
    if (/["'<> \t\n\r]/.test(server.websiteUrl)) add('websiteUrl', 'contains a character that must be percent-encoded');
  }
  server.icons?.forEach((icon, index) => addHttpsUrlIssue(`icons[${index}].src`, icon.src, add));

  const repository = server.repository;
  if (repository && (repository.url || repository.source)) {
    const pattern = REPOSITORY_URL_PATTERNS[repository.source ?? ''];
    if (!pattern?.test(repository.url ?? '')) {
      add(
        'repository',
        'must be a https://github.com/<owner>/<repo> or https://gitlab.com/<owner>/<repo> URL with source "github" or "gitlab"',
      );
    }
    if (repository.subfolder !== undefined && !isCleanRelativePath(repository.subfolder)) {
      add('repository.subfolder', 'must be a relative path without leading or trailing slashes, "." or ".."');
    }
  }

  server.packages?.forEach((entry, index) => {
    const path = `packages[${index}]`;
    if (entry.identifier.includes(' ')) add(`${path}.identifier`, 'must not contain spaces');
    if (entry.version !== undefined) addVersionIssue(`${path}.version`, entry.version, add);
    const transport = entry.transport;
    if (transport.type === 'stdio') {
      if (transport.url) add(`${path}.transport.url`, 'must be empty for the stdio transport');
    } else if (transport.type === 'streamable-http' || transport.type === 'sse') {
      if (!transport.url) add(`${path}.transport.url`, `is required for the ${transport.type} transport`);
    } else {
      add(`${path}.transport.type`, 'must be stdio, streamable-http or sse');
    }
  });

  server.remotes?.forEach((remote, index) => {
    const path = `remotes[${index}]`;
    if (remote.type !== 'streamable-http' && remote.type !== 'sse') {
      add(`${path}.type`, 'must be streamable-http or sse');
    } else if (!remote.url) {
      add(`${path}.url`, `is required for the ${remote.type} transport`);
    } else {
      addRemoteUrlIssue(`${path}.url`, remote.url, add);
    }
  });

  const publisherMeta = server._meta?.[PUBLISHER_META_KEY];
  if (publisherMeta && Buffer.byteLength(JSON.stringify(publisherMeta)) > MAX_PUBLISHER_META_BYTES) {
    add(`_meta.${PUBLISHER_META_KEY}`, 'must be at most 4 KB of JSON');
  }
  return issues;
}

type AddIssue = (path: string, message: string) => void;

function addVersionIssue(path: string, version: string, add: AddIssue): void {
  if (version === 'latest') {
    add(path, '"latest" is reserved; use a specific version');
  } else if (looksLikeVersionRange(version)) {
    add(path, `must be a specific version, not a range ("${version}")`);
  }
}

function looksLikeVersionRange(version: string): boolean {
  if (VERSION_RANGE_PATTERNS.some((pattern) => pattern.test(version))) return true;
  return WILDCARD_VERSION_PATTERN.test(version) && /[xX*]/.test(version);
}

function addHttpsUrlIssue(path: string, value: string, add: AddIssue): void {
  if (parseUrl(value)?.protocol !== 'https:') add(path, `must be an absolute https URL ("${value}")`);
}

function addRemoteUrlIssue(path: string, value: string, add: AddIssue): void {
  const url = parseUrl(value.replace(/\{[^}]+\}/g, 'placeholder'));
  if (url?.protocol !== 'https:') {
    add(path, `must be an absolute https URL ("${value}")`);
  } else if (LOCAL_HOSTNAMES.includes(url.hostname) || url.hostname.endsWith('.localhost')) {
    add(path, `must not point at localhost ("${value}"): list the deployed server's public URL`);
  }
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isCleanRelativePath(path: string): boolean {
  if (!/^[a-zA-Z0-9\-_./]+$/.test(path) || path.startsWith('/') || path.endsWith('/')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join('');
}
