/**
 * Hand-authored schemas that mirror the shape of real FrontMCP schemas
 * (tool input schemas, config schemas, auth payloads).
 * Kept as a separate DSL descriptor list so `generate.ts` can emit
 * identical eager + lazy variants for them alongside generated ones.
 */
import type { SchemaDescriptor } from './descriptor';

export const handAuthoredDescriptors: ReadonlyArray<SchemaDescriptor> = [
  {
    name: 'tool_call_weather',
    kind: 'object',
    fields: [
      { name: 'city', type: 'string', optional: false },
      { name: 'country', type: 'string', optional: true },
      { name: 'units', type: 'enum', values: ['metric', 'imperial', 'kelvin'], optional: true },
      { name: 'days', type: 'number', optional: true },
    ],
  },
  {
    name: 'tool_call_crm_find_contact',
    kind: 'object',
    fields: [
      { name: 'query', type: 'string', optional: false },
      { name: 'limit', type: 'number', optional: true },
      {
        name: 'filters',
        type: 'object',
        children: [
          { name: 'region', type: 'string', optional: true },
          { name: 'tag', type: 'string', optional: true },
          { name: 'active', type: 'boolean', optional: true },
        ],
      },
    ],
  },
  {
    name: 'tool_call_expense_create',
    kind: 'object',
    fields: [
      { name: 'amount', type: 'number', optional: false },
      { name: 'currency', type: 'enum', values: ['USD', 'EUR', 'GBP', 'ILS'], optional: false },
      { name: 'category', type: 'string', optional: false },
      { name: 'note', type: 'string', optional: true },
      {
        name: 'receipt',
        type: 'object',
        optional: true,
        children: [
          { name: 'url', type: 'string', optional: false },
          { name: 'mime', type: 'string', optional: true },
        ],
      },
    ],
  },
  {
    name: 'config_cors',
    kind: 'object',
    fields: [
      { name: 'origins', type: 'array', items: 'string', optional: false },
      { name: 'methods', type: 'array', items: 'string', optional: true },
      { name: 'credentials', type: 'boolean', optional: true },
      { name: 'maxAge', type: 'number', optional: true },
    ],
  },
  {
    name: 'config_deployment_target',
    kind: 'discriminated',
    discriminator: 'kind',
    variants: [
      {
        tag: 'node',
        fields: [
          { name: 'port', type: 'number', optional: false },
          { name: 'host', type: 'string', optional: true },
          { name: 'tls', type: 'boolean', optional: true },
        ],
      },
      {
        tag: 'edge',
        fields: [
          { name: 'region', type: 'string', optional: false },
          { name: 'workerUrl', type: 'string', optional: false },
        ],
      },
      {
        tag: 'lambda',
        fields: [
          { name: 'functionName', type: 'string', optional: false },
          { name: 'memoryMb', type: 'number', optional: true },
          { name: 'timeoutSec', type: 'number', optional: true },
        ],
      },
    ],
  },
  {
    name: 'auth_session_payload',
    kind: 'object',
    fields: [
      { name: 'userId', type: 'string', optional: false },
      { name: 'roles', type: 'array', items: 'string', optional: false },
      { name: 'issuedAt', type: 'number', optional: false },
      { name: 'expiresAt', type: 'number', optional: false },
      {
        name: 'claims',
        type: 'object',
        optional: true,
        children: [
          { name: 'tenantId', type: 'string', optional: true },
          { name: 'email', type: 'string', optional: true },
          { name: 'emailVerified', type: 'boolean', optional: true },
        ],
      },
    ],
  },
  {
    name: 'rbac_policy',
    kind: 'object',
    fields: [
      { name: 'subject', type: 'string', optional: false },
      { name: 'action', type: 'enum', values: ['read', 'write', 'delete', 'admin'], optional: false },
      { name: 'resource', type: 'string', optional: false },
      { name: 'conditions', type: 'array', items: 'string', optional: true },
    ],
  },
  {
    name: 'mcp_tool_result',
    kind: 'object',
    fields: [
      { name: 'content', type: 'array', items: 'string', optional: false },
      { name: 'isError', type: 'boolean', optional: true },
      {
        name: 'structuredContent',
        type: 'object',
        optional: true,
        children: [
          { name: 'type', type: 'string', optional: false },
          { name: 'data', type: 'string', optional: false },
        ],
      },
    ],
  },
  {
    name: 'resource_metadata',
    kind: 'object',
    fields: [
      { name: 'uri', type: 'string', optional: false },
      { name: 'name', type: 'string', optional: false },
      { name: 'description', type: 'string', optional: true },
      { name: 'mimeType', type: 'string', optional: true },
      {
        name: 'annotations',
        type: 'object',
        optional: true,
        children: [
          { name: 'audience', type: 'array', items: 'string', optional: true },
          { name: 'priority', type: 'number', optional: true },
        ],
      },
    ],
  },
  {
    name: 'prompt_argument',
    kind: 'object',
    fields: [
      { name: 'name', type: 'string', optional: false },
      { name: 'description', type: 'string', optional: true },
      { name: 'required', type: 'boolean', optional: true },
    ],
  },
  {
    name: 'elicitation_request',
    kind: 'object',
    fields: [
      { name: 'message', type: 'string', optional: false },
      {
        name: 'requestedSchema',
        type: 'object',
        optional: false,
        children: [
          { name: 'type', type: 'string', optional: false },
          {
            name: 'properties',
            type: 'object',
            optional: false,
            children: [{ name: 'input', type: 'string', optional: false }],
          },
        ],
      },
    ],
  },
  {
    name: 'vault_credential_entry',
    kind: 'object',
    fields: [
      { name: 'id', type: 'string', optional: false },
      { name: 'provider', type: 'string', optional: false },
      { name: 'encrypted', type: 'string', optional: false },
      { name: 'createdAt', type: 'number', optional: false },
      { name: 'expiresAt', type: 'number', optional: true },
      { name: 'meta', type: 'record', keys: ['provider', 'region', 'env'], optional: true },
    ],
  },
  {
    name: 'skill_manifest',
    kind: 'object',
    fields: [
      { name: 'id', type: 'string', optional: false },
      { name: 'name', type: 'string', optional: false },
      { name: 'description', type: 'string', optional: false },
      { name: 'category', type: 'enum', values: ['auth', 'data', 'ui', 'infra', 'observability'], optional: false },
      { name: 'tags', type: 'array', items: 'string', optional: true },
      { name: 'deploymentTargets', type: 'array', items: 'string', optional: true },
    ],
  },
  {
    name: 'feature_flag_rule',
    kind: 'discriminated',
    discriminator: 'ruleType',
    variants: [
      { tag: 'boolean', fields: [{ name: 'enabled', type: 'boolean', optional: false }] },
      {
        tag: 'percentage',
        fields: [
          { name: 'percent', type: 'number', optional: false },
          { name: 'salt', type: 'string', optional: true },
        ],
      },
      { tag: 'allowlist', fields: [{ name: 'userIds', type: 'array', items: 'string', optional: false }] },
    ],
  },
  {
    name: 'http_request_input',
    kind: 'object',
    fields: [
      { name: 'method', type: 'enum', values: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], optional: false },
      { name: 'url', type: 'string', optional: false },
      { name: 'headers', type: 'record', keys: ['authorization', 'content-type', 'x-trace-id'], optional: true },
      { name: 'body', type: 'string', optional: true },
      { name: 'timeoutMs', type: 'number', optional: true },
    ],
  },
];
