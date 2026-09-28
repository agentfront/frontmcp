import { PublicMcpError } from './mcp.error';

/**
 * Thrown at startup when entries declare metadata that only a plugin enforces (such as `approval`
 * or `featureFlag`) and no plugin that enforces it reaches them, so the field would silently do
 * nothing.
 */
export class UnenforcedMetadataError extends PublicMcpError {
  /** One line per entry and field, e.g. `Tool "wipe_disk" declares 'approval' (enforced by …)`. */
  readonly errors: string[];
  readonly suggestion: string;

  constructor(problems: string[]) {
    const shown = problems.slice(0, 5).join('; ');
    const suffix = problems.length > 5 ? `; and ${problems.length - 5} more` : '';
    super(
      `Unenforced metadata: ${shown}${suffix}. No installed plugin that enforces these fields covers ` +
        `the entries, so the fields would do nothing.`,
      'UNENFORCED_METADATA',
      500,
    );
    this.errors = problems;
    this.suggestion =
      'Install the plugin that enforces each field, on the server (@FrontMcp({ plugins })) or on an app of the ' +
      'same server, or remove the field from the entry. Tools declared inside an @Agent are enforced only by ' +
      'plugins installed on that agent.';
  }

  override getPublicMessage(): string {
    return `${this.message}\n\nTo fix this issue:\n${this.suggestion}`;
  }
}
