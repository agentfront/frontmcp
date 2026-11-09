import { PublicMcpError } from './mcp.error';

/** Thrown at startup when a tool's `ui` sets a rendering option its template cannot take. */
export class ToolUiConfigurationError extends PublicMcpError {
  /** One sentence per option the template cannot take. */
  readonly problems: string[];

  constructor(toolName: string, problems: string[]) {
    super(`Tool "${toolName}": ${problems.join(' ')}`, 'TOOL_UI_CONFIGURATION', 500);
    this.problems = problems;
  }
}
