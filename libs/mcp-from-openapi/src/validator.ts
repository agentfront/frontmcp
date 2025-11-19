import type { OpenAPIDocument, ValidationResult, ValidationErrorDetail, ValidationWarning } from './types';
import { ValidationError } from './errors';

/**
 * Validates OpenAPI documents
 */
export class Validator {
  /**
   * Validate an OpenAPI document
   */
  async validate(document: OpenAPIDocument): Promise<ValidationResult> {
    const errors: ValidationErrorDetail[] = [];
    const warnings: ValidationWarning[] = [];

    // Check OpenAPI version
    if (!document.openapi) {
      errors.push({
        message: 'Missing required field: openapi',
        path: '/openapi',
        code: 'MISSING_OPENAPI_VERSION',
      });
    } else if (!this.isValidOpenAPIVersion(document.openapi)) {
      errors.push({
        message: `Unsupported OpenAPI version: ${document.openapi}. Expected 3.0.x or 3.1.x`,
        path: '/openapi',
        code: 'INVALID_OPENAPI_VERSION',
      });
    }

    // Check info
    if (!document.info) {
      errors.push({
        message: 'Missing required field: info',
        path: '/info',
        code: 'MISSING_INFO',
      });
    } else {
      if (!document.info.title) {
        errors.push({
          message: 'Missing required field: info.title',
          path: '/info/title',
          code: 'MISSING_TITLE',
        });
      }
      if (!document.info.version) {
        errors.push({
          message: 'Missing required field: info.version',
          path: '/info/version',
          code: 'MISSING_VERSION',
        });
      }
    }

    // Check paths
    if (!document.paths || Object.keys(document.paths).length === 0) {
      warnings.push({
        message: 'No paths defined in OpenAPI document',
        path: '/paths',
        code: 'NO_PATHS',
      });
    } else {
      this.validatePaths(document.paths, errors, warnings);
    }

    // Check servers
    if (!document.servers || document.servers.length === 0) {
      warnings.push({
        message: 'No servers defined. You may need to provide a baseUrl option.',
        path: '/servers',
        code: 'NO_SERVERS',
      });
    }

    // Check security schemes
    if (document.security && !document.components?.securitySchemes) {
      warnings.push({
        message: 'Security requirements defined but no security schemes found',
        path: '/security',
        code: 'NO_SECURITY_SCHEMES',
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Check if OpenAPI version is valid
   */
  private isValidOpenAPIVersion(version: string): boolean {
    return /^3\.[01]\.\d+$/.test(version);
  }

  /**
   * Validate paths
   */
  private validatePaths(
    paths: Record<string, any>,
    errors: ValidationErrorDetail[],
    warnings: ValidationWarning[],
  ): void {
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      // Check path format
      if (!path.startsWith('/')) {
        errors.push({
          message: `Path must start with '/': ${path}`,
          path: `/paths/${path}`,
          code: 'INVALID_PATH_FORMAT',
        });
      }

      // Validate operations
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
      let hasOperations = false;

      for (const method of methods) {
        const operation = pathItem[method];
        if (operation) {
          hasOperations = true;
          this.validateOperation(operation, path, method, errors, warnings);
        }
      }

      if (!hasOperations && !pathItem.$ref) {
        warnings.push({
          message: `Path has no operations: ${path}`,
          path: `/paths/${path}`,
          code: 'NO_OPERATIONS',
        });
      }
    }
  }

  /**
   * Validate an operation
   */
  private validateOperation(
    operation: any,
    path: string,
    method: string,
    errors: ValidationErrorDetail[],
    warnings: ValidationWarning[],
  ): void {
    const basePath = `/paths/${path}/${method}`;

    // Check for operationId
    if (!operation.operationId) {
      warnings.push({
        message: `Operation missing operationId: ${method.toUpperCase()} ${path}`,
        path: `${basePath}/operationId`,
        code: 'NO_OPERATION_ID',
      });
    }

    // Check for responses
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      errors.push({
        message: `Operation missing responses: ${method.toUpperCase()} ${path}`,
        path: `${basePath}/responses`,
        code: 'NO_RESPONSES',
      });
    }

    // Validate parameters
    if (operation.parameters) {
      this.validateParameters(operation.parameters, path, method, errors, warnings);
    }

    // Check for path parameters in path string
    const pathParams = path.match(/\{([^}]+)\}/g)?.map((p) => p.slice(1, -1)) ?? [];
    const definedPathParams = new Set(
      operation.parameters?.filter((p: any) => p.in === 'path').map((p: any) => p.name) ?? [],
    );

    for (const param of pathParams) {
      if (!definedPathParams.has(param)) {
        errors.push({
          message: `Path parameter '${param}' not defined in parameters: ${method.toUpperCase()} ${path}`,
          path: `${basePath}/parameters`,
          code: 'MISSING_PATH_PARAMETER',
        });
      }
    }
  }

  /**
   * Validate parameters
   */
  private validateParameters(
    parameters: any[],
    path: string,
    method: string,
    errors: ValidationErrorDetail[],
    warnings: ValidationWarning[],
  ): void {
    const basePath = `/paths/${path}/${method}/parameters`;

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      const paramPath = `${basePath}/${i}`;

      if (!param.name) {
        errors.push({
          message: 'Parameter missing name',
          path: `${paramPath}/name`,
          code: 'MISSING_PARAMETER_NAME',
        });
      }

      if (!param.in) {
        errors.push({
          message: 'Parameter missing "in" field',
          path: `${paramPath}/in`,
          code: 'MISSING_PARAMETER_IN',
        });
      } else if (!['path', 'query', 'header', 'cookie'].includes(param.in)) {
        errors.push({
          message: `Invalid parameter location: ${param.in}`,
          path: `${paramPath}/in`,
          code: 'INVALID_PARAMETER_IN',
        });
      }

      if (param.in === 'path' && !param.required) {
        errors.push({
          message: `Path parameter '${param.name}' must be required`,
          path: `${paramPath}/required`,
          code: 'PATH_PARAMETER_NOT_REQUIRED',
        });
      }

      if (!param.schema && !param.content) {
        errors.push({
          message: `Parameter '${param.name}' missing schema or content`,
          path: `${paramPath}`,
          code: 'MISSING_PARAMETER_SCHEMA',
        });
      }
    }
  }
}
