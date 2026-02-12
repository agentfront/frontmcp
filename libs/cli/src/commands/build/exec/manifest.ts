/**
 * ExecManifest type + generation.
 * The manifest is a JSON file that describes the bundled app
 * for installation and runtime.
 */

import { FrontmcpExecConfig } from './config';
import { SetupStep, zodSchemaToJsonSchema, idToEnvName } from './setup';

export interface ExecManifest {
  name: string;
  version: string;
  nodeVersion: string;
  storage: {
    type: 'sqlite' | 'redis' | 'none';
    required: boolean;
  };
  network: {
    defaultPort: number;
    supportsSocket: boolean;
  };
  dependencies: {
    system: string[];
    nativeAddons: string[];
  };
  bundle: string; // bundle filename
  setup?: {
    steps: ManifestSetupStep[];
  };
}

export interface ManifestSetupStep {
  id: string;
  prompt: string;
  description?: string;
  jsonSchema: Record<string, unknown>;
  env: string;
  sensitive?: boolean;
  group?: string;
  next?: string | Record<string, string>;
  showWhen?: Record<string, string | string[]>;
}

export function generateManifest(
  config: FrontmcpExecConfig,
  bundleFilename: string,
): ExecManifest {
  const manifest: ExecManifest = {
    name: config.name,
    version: config.version || '1.0.0',
    nodeVersion: config.nodeVersion || '>=22.0.0',
    storage: {
      type: config.storage?.type || 'none',
      required: config.storage?.required ?? false,
    },
    network: {
      defaultPort: config.network?.defaultPort || 3001,
      supportsSocket: config.network?.supportsSocket ?? true,
    },
    dependencies: {
      system: config.dependencies?.system || [],
      nativeAddons: config.dependencies?.nativeAddons || [],
    },
    bundle: bundleFilename,
  };

  // Convert setup steps — serialize Zod schemas to JSON Schema
  if (config.setup?.steps && config.setup.steps.length > 0) {
    manifest.setup = {
      steps: config.setup.steps.map((step) => serializeStep(step)),
    };
  }

  return manifest;
}

function serializeStep(step: SetupStep): ManifestSetupStep {
  let jsonSchema: Record<string, unknown> = { type: 'string' };

  if (step.jsonSchema) {
    // Already serialized (e.g., from JSON config)
    jsonSchema = step.jsonSchema;
  } else if (step.schema) {
    // Convert Zod schema to JSON Schema
    jsonSchema = zodSchemaToJsonSchema(step.schema);
  }

  return {
    id: step.id,
    prompt: step.prompt,
    description: step.description,
    jsonSchema,
    env: step.env || idToEnvName(step.id),
    sensitive: step.sensitive,
    group: step.group,
    next: step.next,
    showWhen: step.showWhen,
  };
}
