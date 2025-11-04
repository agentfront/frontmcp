// Specific error surfaced by app.tools.executeTool when the tool isn't owned by that app
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}
