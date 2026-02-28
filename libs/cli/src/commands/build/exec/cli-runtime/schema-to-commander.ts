/**
 * Converts JSON Schema properties to commander.js option definitions.
 * Used at code-generation time (not runtime) to map MCP tool input schemas
 * to CLI option strings that commander can parse.
 */

export interface CommanderOption {
  /** commander flags string, e.g. '--name <value>' */
  flags: string;
  /** description from JSON Schema */
  description: string;
  /** whether this is a required option */
  required: boolean;
  /** for enum types, the allowed choices */
  choices?: string[];
  /** default value if specified in schema */
  defaultValue?: unknown;
  /** coercion function name: 'parseInt', 'parseFloat', or undefined */
  coercion?: 'parseInt' | 'parseFloat';
  /** whether this is a variadic (array) option */
  variadic: boolean;
}

export interface SchemaToCommanderResult {
  options: CommanderOption[];
  /** property names that couldn't be mapped */
  skipped: string[];
}

/**
 * Convert a JSON Schema `properties` object into commander option definitions.
 */
export function schemaToCommander(
  schema: Record<string, unknown>,
): SchemaToCommanderResult {
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  const options: CommanderOption[] = [];
  const skipped: string[] = [];

  for (const [propName, propSchema] of Object.entries(properties)) {
    const opt = propertyToOption(propName, propSchema, required.has(propName));
    if (opt) {
      options.push(opt);
    } else {
      skipped.push(propName);
    }
  }

  return { options, skipped };
}

function propertyToOption(
  name: string,
  schema: Record<string, unknown>,
  isRequired: boolean,
): CommanderOption | null {
  const kebab = camelToKebab(name);
  const description = (schema.description as string) || '';
  const defaultValue = schema.default;
  const enumValues = schema.enum as string[] | undefined;

  // Resolve type — handle array types like ["string", "null"]
  let type = schema.type as string | string[] | undefined;
  if (Array.isArray(type)) {
    type = type.find((t) => t !== 'null') || type[0];
  }

  // Handle enum — always treat as string choices
  if (enumValues && Array.isArray(enumValues)) {
    return {
      flags: `--${kebab} <value>`,
      description,
      required: isRequired,
      choices: enumValues.map(String),
      defaultValue,
      variadic: false,
    };
  }

  switch (type) {
    case 'string':
      return {
        flags: `--${kebab} <value>`,
        description,
        required: isRequired,
        defaultValue,
        variadic: false,
      };

    case 'number':
      return {
        flags: `--${kebab} <number>`,
        description,
        required: isRequired,
        defaultValue,
        coercion: 'parseFloat',
        variadic: false,
      };

    case 'integer':
      return {
        flags: `--${kebab} <number>`,
        description,
        required: isRequired,
        defaultValue,
        coercion: 'parseInt',
        variadic: false,
      };

    case 'boolean':
      return {
        flags: `--${kebab}`,
        description,
        required: false, // boolean flags are never "required" in commander sense
        defaultValue: defaultValue ?? false,
        variadic: false,
      };

    case 'array': {
      const itemType = (schema.items as Record<string, unknown>)?.type;
      const coercion = itemType === 'number'
        ? 'parseFloat' as const
        : itemType === 'integer'
          ? 'parseInt' as const
          : undefined;
      return {
        flags: `--${kebab} <items...>`,
        description,
        required: isRequired,
        defaultValue,
        coercion,
        variadic: true,
      };
    }

    case 'object':
      // Complex objects: accept as JSON string
      return {
        flags: `--${kebab} <json>`,
        description: description ? `${description} (JSON string)` : '(JSON string)',
        required: isRequired,
        defaultValue,
        variadic: false,
      };

    default:
      // Unknown type — skip
      return null;
  }
}

/**
 * Convert camelCase or PascalCase to kebab-case.
 */
export function camelToKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Generate commander option code string for embedding in generated CLI entry.
 */
export function generateOptionCode(opt: CommanderOption): string {
  const parts: string[] = [];

  if (opt.required) {
    parts.push(`.requiredOption('${opt.flags}', '${escapeStr(opt.description)}'`);
  } else {
    parts.push(`.option('${opt.flags}', '${escapeStr(opt.description)}'`);
  }

  if (opt.coercion === 'parseInt') {
    parts.push(`, (v) => parseInt(v, 10)`);
  } else if (opt.coercion === 'parseFloat') {
    parts.push(`, (v) => parseFloat(v)`);
  }

  if (opt.defaultValue !== undefined && !opt.required) {
    parts.push(`, ${JSON.stringify(opt.defaultValue)}`);
  }

  parts.push(')');

  let code = parts.join('');

  if (opt.choices) {
    code += `.choices(${JSON.stringify(opt.choices)})`;
  }

  return code;
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
