import {
  schemaToCommander,
  camelToKebab,
  generateOptionCode,
  CommanderOption,
} from '../cli-runtime/schema-to-commander';

describe('schemaToCommander', () => {
  it('should convert string property to --name <value>', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' },
      },
      required: ['name'],
    });

    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toEqual({
      flags: '--name <value>',
      description: 'User name',
      required: true,
      defaultValue: undefined,
      variadic: false,
    });
    expect(result.skipped).toEqual([]);
  });

  it('should convert number property with parseFloat coercion', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        price: { type: 'number', description: 'Price in dollars' },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--price <number>',
      coercion: 'parseFloat',
      required: false,
    });
  });

  it('should convert integer property with parseInt coercion', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        count: { type: 'integer', description: 'Item count' },
      },
      required: ['count'],
    });

    expect(result.options[0]).toMatchObject({
      flags: '--count <number>',
      coercion: 'parseInt',
      required: true,
    });
  });

  it('should convert boolean property to flag (no value)', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Enable verbose output' },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--verbose',
      required: false, // booleans are never required
      defaultValue: false,
    });
  });

  it('should convert boolean with explicit default true', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable', default: true },
      },
    });

    expect(result.options[0].defaultValue).toBe(true);
  });

  it('should convert enum to choices', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: 'Output format',
          enum: ['json', 'text', 'csv'],
        },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--format <value>',
      choices: ['json', 'text', 'csv'],
    });
  });

  it('should convert array property to variadic', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          description: 'Tags to apply',
          items: { type: 'string' },
        },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--tags <items...>',
      variadic: true,
    });
  });

  it('should convert array of numbers with coercion', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        scores: {
          type: 'array',
          items: { type: 'integer' },
        },
      },
    });

    expect(result.options[0]).toMatchObject({
      variadic: true,
      coercion: 'parseInt',
    });
  });

  it('should convert object property to JSON string', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        config: { type: 'object', description: 'Configuration' },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--config <json>',
      description: 'Configuration (JSON string)',
    });
  });

  it('should convert camelCase to kebab-case in flags', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        outputFormat: { type: 'string' },
        maxRetries: { type: 'integer' },
      },
    });

    expect(result.options[0].flags).toBe('--output-format <value>');
    expect(result.options[1].flags).toBe('--max-retries <number>');
  });

  it('should handle nullable types (string | null)', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        label: { type: ['string', 'null'], description: 'Optional label' },
      },
    });

    expect(result.options[0]).toMatchObject({
      flags: '--label <value>',
      description: 'Optional label',
    });
  });

  it('should handle default values on optional properties', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        port: { type: 'integer', default: 3000 },
      },
    });

    expect(result.options[0].defaultValue).toBe(3000);
  });

  it('should skip unknown types and report them', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        normal: { type: 'string' },
        weird: { type: 'weird-type' as string },
      },
    });

    expect(result.options).toHaveLength(1);
    expect(result.skipped).toEqual(['weird']);
  });

  it('should handle empty schema', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {},
    });

    expect(result.options).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('should handle missing properties', () => {
    const result = schemaToCommander({ type: 'object' });

    expect(result.options).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('should handle missing required array', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: { name: { type: 'string' } },
    });

    expect(result.options[0].required).toBe(false);
  });

  it('should handle multiple properties with mixed required', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        email: { type: 'string' },
      },
      required: ['name', 'email'],
    });

    expect(result.options).toHaveLength(3);
    expect(result.options.find((o) => o.flags.includes('name'))!.required).toBe(true);
    expect(result.options.find((o) => o.flags.includes('age'))!.required).toBe(false);
    expect(result.options.find((o) => o.flags.includes('email'))!.required).toBe(true);
  });

  it('should handle enum with non-string values', () => {
    const result = schemaToCommander({
      type: 'object',
      properties: {
        level: { enum: [1, 2, 3], description: 'Log level' },
      },
    });

    expect(result.options[0].choices).toEqual(['1', '2', '3']);
  });
});

describe('camelToKebab', () => {
  it('should convert simple camelCase', () => {
    expect(camelToKebab('outputFormat')).toBe('output-format');
  });

  it('should convert PascalCase', () => {
    expect(camelToKebab('OutputFormat')).toBe('output-format');
  });

  it('should handle consecutive uppercase letters', () => {
    expect(camelToKebab('parseJSON')).toBe('parse-json');
    expect(camelToKebab('getHTTPResponse')).toBe('get-http-response');
  });

  it('should handle single word', () => {
    expect(camelToKebab('name')).toBe('name');
  });

  it('should handle already kebab-case', () => {
    expect(camelToKebab('already-kebab')).toBe('already-kebab');
  });

  it('should handle numbers in name', () => {
    expect(camelToKebab('page2Size')).toBe('page2-size');
  });
});

describe('generateOptionCode', () => {
  it('should generate required option code', () => {
    const opt: CommanderOption = {
      flags: '--name <value>',
      description: "User's name",
      required: true,
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain(".requiredOption('--name <value>'");
    expect(code).toContain("User\\'s name");
  });

  it('should generate optional option code', () => {
    const opt: CommanderOption = {
      flags: '--verbose',
      description: 'Verbose mode',
      required: false,
      defaultValue: false,
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain(".option('--verbose'");
    expect(code).toContain(', false)');
  });

  it('should generate parseInt coercion', () => {
    const opt: CommanderOption = {
      flags: '--count <number>',
      description: 'Count',
      required: false,
      coercion: 'parseInt',
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain('parseInt(v, 10)');
  });

  it('should generate parseFloat coercion', () => {
    const opt: CommanderOption = {
      flags: '--price <number>',
      description: 'Price',
      required: false,
      coercion: 'parseFloat',
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain('parseFloat(v)');
  });

  it('should generate choices', () => {
    const opt: CommanderOption = {
      flags: '--format <value>',
      description: 'Format',
      required: false,
      choices: ['json', 'text'],
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain('.choices(["json","text"])');
  });

  it('should not include default for required options', () => {
    const opt: CommanderOption = {
      flags: '--name <value>',
      description: 'Name',
      required: true,
      defaultValue: 'default',
      variadic: false,
    };

    const code = generateOptionCode(opt);
    expect(code).toContain('.requiredOption(');
    // Default should NOT be present for required options
    expect(code).not.toContain('"default"');
  });
});
