// file: libs/plugins/src/codecall/codecall.types.ts

export type CodeCallMode = 'codecall_only' | 'codecall_opt_in' | 'metadata_driven';

export type CodeCallVmPreset = 'locked_down' | 'secure' | 'balanced' | 'experimental';

export interface CodeCallVmOptions {
  /**
   * CSP-like preset; see README.
   * @default 'secure'
   */
  preset?: CodeCallVmPreset;

  timeoutMs?: number;
  allowLoops?: boolean;
  maxSteps?: number;
  disabledBuiltins?: string[];
  disabledGlobals?: string[];
  allowConsole?: boolean;
}

export interface CodeCallDirectCallsOptions {
  /**
   * Enable/disable the `codecall.invoke` meta-tool.
   */
  enabled: boolean;

  /**
   * Optional allowlist of tool names.
   */
  allowedTools?: string[];

  /**
   * Optional advanced filter.
   */
  filter?: (tool: { name: string; appId?: string; source?: string; tags?: string[] }) => boolean;
}

/**
 * Plugin-level options (from README).
 */
export interface CodeCallPluginOptions {
  mode?: CodeCallMode;
  topK?: number;
  maxDefinitions?: number;

  includeTools?: (tool: {
    name: string;
    appId?: string;
    source?: string;
    description?: string;
    tags?: string[];
  }) => boolean;

  directCalls?: CodeCallDirectCallsOptions;
  vm?: CodeCallVmOptions;
}

/**
 * Per-tool metadata used by CodeCall.
 * This maps to `metadata.codecall` on tools.
 */
export interface CodeCallToolMetadata {
  /**
   * If true, this tool stays visible in `list_tools`
   * even when CodeCall is hiding most tools.
   */
  visibleInListTools?: boolean;

  /**
   * Whether this tool can be used via CodeCall.
   * Semantics depend on CodeCallMode (see README).
   */
  enabledInCodeCall?: boolean;

  /** Optional extra indexing hints */
  appId?: string;
  source?: string;
  tags?: string[];
}

// ----- meta-tool contracts -----

export type CodeCallSearchInput = {
  query: string;
  topK?: number;
  filter?: {
    appIds?: string[];
    tags?: string[];
    includeOpenApi?: boolean;
    includeInline?: boolean;
  };
};

export type CodeCallSearchResult = {
  tools: {
    name: string;
    description: string;
    appId?: string;
    source?: string;
    score: number;
  }[];
};

export type CodeCallDescribeInput = {
  tools: string[];
  max?: number;
};

export type CodeCallDescribeResult = {
  tools: {
    name: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown | null;
    examples?: {
      input: unknown;
      output?: unknown;
    }[];
  }[];
};

export type CodeCallExecuteInput = {
  script: string;
  /**
   * Arbitrary, readonly context exposed as `codecallContext`.
   */
  context?: Record<string, unknown>;
};

// ---- global FrontMCP metadata extension ----

declare global {
  interface ExtendFrontMcpToolMetadata {
    /**
     * CodeCall-specific metadata, attached via `@Tool({ metadata: { codecall: ... } })`
     * or whatever your decorator mapping is.
     */
    codecall?: CodeCallToolMetadata;
  }
}
