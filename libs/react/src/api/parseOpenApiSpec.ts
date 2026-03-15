/**
 * parseOpenApiSpec — extracts ApiOperation[] from an OpenAPI 3.x JSON spec.
 *
 * Lightweight parser that pulls operationId, method, path, description,
 * and builds a JSON Schema for the input from parameters and requestBody.
 */

import type { ApiOperation } from './api.types';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

export function parseOpenApiSpec(spec: Record<string, unknown>): ApiOperation[] {
  const paths = spec['paths'] as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return [];

  const operations: ApiOperation[] = [];
  const usedIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== 'object') continue;

      const rawOperationId = operation['operationId'];
      let operationId =
        typeof rawOperationId === 'string' ? rawOperationId : `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // De-duplicate operationIds
      if (usedIds.has(operationId)) {
        let suffix = 1;
        while (usedIds.has(`${operationId}_${suffix}`)) suffix++;
        operationId = `${operationId}_${suffix}`;
      }
      usedIds.add(operationId);

      const rawSummary = operation['summary'];
      const rawDescription = operation['description'];
      const description =
        (typeof rawSummary === 'string' ? rawSummary : undefined) ??
        (typeof rawDescription === 'string' ? rawDescription : undefined) ??
        `${method.toUpperCase()} ${path}`;

      // Build input schema from parameters + requestBody
      const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const required: string[] = [];

      // Merge path-level and operation-level parameters (operation overrides path)
      const rawPathParams = pathItem['parameters'];
      const rawOpParams = operation['parameters'];
      const pathParams = Array.isArray(rawPathParams) ? rawPathParams.filter(Boolean) : [];
      const opParams = Array.isArray(rawOpParams) ? rawOpParams.filter(Boolean) : [];

      const paramMap = new Map<string, OpenApiParameter>();
      for (const param of pathParams) {
        if (typeof param === 'object' && param !== null && param.name) {
          paramMap.set(`${param.in}:${param.name}`, param as OpenApiParameter);
        }
      }
      for (const param of opParams) {
        if (typeof param === 'object' && param !== null && param.name) {
          paramMap.set(`${param.in}:${param.name}`, param as OpenApiParameter);
        }
      }

      for (const param of paramMap.values()) {
        if (param.name === '__proto__' || param.name === 'constructor' || param.name === 'prototype') continue;
        properties[param.name] = {
          ...(param.schema ?? { type: 'string' }),
          description: param.description,
        };
        if (param.required) required.push(param.name);
      }

      // Request body
      const requestBody = operation['requestBody'] as Record<string, unknown> | undefined;
      if (requestBody) {
        const content = requestBody['content'] as Record<string, Record<string, unknown>> | undefined;
        const jsonContent = content?.['application/json'];
        if (jsonContent?.['schema']) {
          properties['body'] = {
            ...(jsonContent['schema'] as Record<string, unknown>),
            description: 'Request body',
          };
          if (requestBody['required']) required.push('body');
        }
      }

      const inputSchema: Record<string, unknown> = {
        type: 'object',
        properties,
      };
      if (required.length > 0) {
        inputSchema['required'] = required;
      }

      operations.push({ operationId, description, method: method.toUpperCase(), path, inputSchema });
    }
  }

  return operations;
}
