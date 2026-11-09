import { InternalMcpError, PublicMcpError } from './mcp.error';

/** Thrown at startup when a tool's `ui` sets a rendering option its template cannot take. */
export class ToolUiConfigurationError extends PublicMcpError {
  /** One sentence per option the template cannot take. */
  readonly problems: string[];

  constructor(toolName: string, problems: string[]) {
    super(`Tool "${toolName}": ${problems.join(' ')}`, 'TOOL_UI_CONFIGURATION', 500);
    this.problems = problems;
  }
}

/** Thrown at boot for a tool `ui` config the server cannot serve, one line per problem. */
export class InvalidToolUiConfigError extends InternalMcpError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid tool ui config:\n- ${problems.join('\n- ')}`, 'INVALID_TOOL_UI_CONFIG');
    this.problems = problems;
  }
}
